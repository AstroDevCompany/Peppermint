/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Installs and switches the ad blocker extension the user picked. Peppermint
 * has no blocking engine of its own: the extension does all the work, and
 * this module only keeps the right one installed.
 */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  AddonManager: "resource://gre/modules/AddonManager.sys.mjs",
  AddonRepository: "resource://gre/modules/addons/AddonRepository.sys.mjs",
  CustomizableUI:
    "moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs",
});

const PREF_SELECTED = "peppermint.adblocker.selected";
// The extension this module installed, so that only that one is removed when
// the user switches. An extension the user installed themselves is left alone.
const PREF_MANAGED = "peppermint.adblocker.managed-id";

export const DEFAULT_ADBLOCKER = "adblock";

export const ADBLOCKERS = Object.freeze([
  { key: "ublock", id: "uBlock0@raymondhill.net", name: "uBlock Origin" },
  {
    key: "adguard",
    id: "adguardadblocker@adguard.com",
    name: "AdGuard AdBlocker",
  },
  { key: "ghostery", id: "firefox@ghostery.com", name: "Ghostery" },
  { key: "adblock", id: "jid1-NIfFY2CA8fy1tg@jetpack", name: "AdBlock" },
]);

function byKey(key) {
  return ADBLOCKERS.find(blocker => blocker.key === key);
}

// Extensions are added to the toolbar by default; the blocker should work
// without taking up space there.
function unpin(addonId) {
  const widgetId =
    addonId.toLowerCase().replace(/[^a-z0-9_-]/g, "_") + "-browser-action";
  try {
    if (lazy.CustomizableUI.getPlacementOfWidget(widgetId)) {
      lazy.CustomizableUI.addWidgetToArea(
        widgetId,
        lazy.CustomizableUI.AREA_ADDONS
      );
    }
  } catch (ex) {
    console.error(ex);
  }
}

async function sync() {
  const blocker = PeppermintAdblocker.selected;
  const managed = Services.prefs.getStringPref(PREF_MANAGED, "");
  let owned = managed === blocker.id ? managed : "";
  if (!(await lazy.AddonManager.getAddonByID(blocker.id))) {
    const [found] = await lazy.AddonRepository.getAddonsByIDs([blocker.id]);
    if (!found?.sourceURI) {
      throw new Error(`${blocker.name} is not available to install`);
    }
    const install = await lazy.AddonManager.getInstallForURL(
      found.sourceURI.spec,
      { name: found.name, icons: found.icons }
    );
    await install.install();
    owned = blocker.id;
    unpin(blocker.id);
  }
  // The old one goes last, so a failed install never leaves the user bare.
  if (managed && managed !== blocker.id) {
    const previous = await lazy.AddonManager.getAddonByID(managed);
    await previous?.uninstall();
  }
  Services.prefs.setStringPref(PREF_MANAGED, owned);
}

let gQueue = Promise.resolve();

export const PeppermintAdblocker = {
  get selected() {
    return (
      byKey(Services.prefs.getStringPref(PREF_SELECTED, DEFAULT_ADBLOCKER)) ||
      byKey(DEFAULT_ADBLOCKER)
    );
  },

  /**
   * @returns {Promise<boolean>} Whether the selected blocker is installed
   */
  async isInstalled() {
    return !!(await lazy.AddonManager.getAddonByID(this.selected.id));
  },

  /**
   * Makes `key` the ad blocker and installs it right away, removing the one
   * Peppermint installed before it.
   *
   * @param {string} key One of ADBLOCKERS[].key
   * @returns {Promise<boolean>} Whether the blocker is installed afterwards
   */
  select(key) {
    if (!byKey(key)) {
      throw new Error(`Unknown ad blocker: ${key}`);
    }
    Services.prefs.setStringPref(PREF_SELECTED, key);
    return this.install();
  },

  /**
   * Installs the selected blocker if it is missing. Calls are queued, so
   * quick consecutive choices settle on the last one.
   *
   * @returns {Promise<boolean>} Whether the blocker is installed afterwards
   */
  install() {
    const run = gQueue.then(sync);
    gQueue = run.catch(() => {});
    return run.then(
      () => true,
      ex => {
        console.error("Ad blocker install failed", ex);
        return false;
      }
    );
  },
};
