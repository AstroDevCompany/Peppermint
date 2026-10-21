// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// YouTube refuses to play while it detects an ad blocker, and what gets past
// that changes often. Two settings let a person step around it: pause the
// built-in blocker on YouTube (ZenAdblockManager does that), and optionally
// turn on another ad blocker extension for as long as a YouTube tab is open.

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  AddonManager: "resource://gre/modules/AddonManager.sys.mjs",
  clearTimeout: "resource://gre/modules/Timer.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
  isYouTubeHost: "resource:///modules/zen/adblock/ZenAdblockVideo.sys.mjs",
});

const PREF_PAUSE = "zen.adblock.youtube.pause";
const PREF_EXTENSION = "zen.adblock.youtube.extension";
// The extension this module turned on, so only that one is turned off again.
const PREF_STARTED = "zen.adblock.youtube.extension-started";

// Navigations come in bursts; one look at the tabs is enough for each.
const CHECK_DELAY_MS = 500;
const STARTUP_DELAY_MS = 3000;
// Leaving YouTube for a moment should not switch the extension off and on.
const DISABLE_DELAY_MS = 20000;
// Time for a freshly enabled extension to load its filters.
const RELOAD_DELAY_MS = 2000;

/**
 * What to do with the extension given what is open and what state it is in.
 *
 * @param {object} state
 * @param {string} state.selected The extension chosen in settings, or "".
 * @param {number} state.youtubeTabs Open tabs showing YouTube.
 * @param {boolean} state.enabled Whether the extension is turned on now.
 * @param {boolean} state.started Whether this module turned it on.
 * @returns {"enable" | "disable" | null}
 */
export function decideExtensionAction({
  selected,
  youtubeTabs,
  enabled,
  started,
}) {
  if (selected && youtubeTabs > 0) {
    return enabled ? null : "enable";
  }
  // Nothing to run it for, or it is no longer wanted: put it back as it was,
  // but only if it was this module that turned it on.
  return started && enabled ? "disable" : null;
}

class ZenAdblockYouTube {
  #initialized = false;
  #checkTimer = null;
  #disableTimer = null;
  #watched = new WeakSet();
  #listener = null;

  init() {
    if (this.#initialized || Services.appinfo.inSafeMode) {
      return;
    }
    this.#initialized = true;
    this.#listener = {
      onLocationChange: (browser, webProgress) => {
        if (webProgress.isTopLevel) {
          this.#scheduleCheck();
        }
      },
    };
    Services.prefs.addObserver(PREF_PAUSE, this);
    Services.prefs.addObserver(PREF_EXTENSION, this);
    Services.obs.addObserver(this, "browser-delayed-startup-finished");
    Services.obs.addObserver(this, "quit-application");
    for (const win of Services.wm.getEnumerator("navigator:browser")) {
      this.#watch(win);
    }
    this.#scheduleCheck(STARTUP_DELAY_MS);
  }

  observe(subject, topic) {
    if (topic === "quit-application") {
      Services.prefs.removeObserver(PREF_PAUSE, this);
      Services.prefs.removeObserver(PREF_EXTENSION, this);
      Services.obs.removeObserver(this, "browser-delayed-startup-finished");
      Services.obs.removeObserver(this, "quit-application");
      lazy.clearTimeout(this.#checkTimer);
      lazy.clearTimeout(this.#disableTimer);
      return;
    }
    if (topic === "browser-delayed-startup-finished") {
      this.#watch(subject);
    }
    this.#scheduleCheck();
  }

  #watch(win) {
    if (!win?.gBrowser || this.#watched.has(win)) {
      return;
    }
    this.#watched.add(win);
    win.gBrowser.addTabsProgressListener(this.#listener);
    win.addEventListener("TabClose", () => this.#scheduleCheck());
    win.addEventListener("unload", () => this.#scheduleCheck());
  }

  #selected() {
    return Services.prefs.getBoolPref(PREF_PAUSE, false)
      ? Services.prefs.getStringPref(PREF_EXTENSION, "")
      : "";
  }

  /**
   * @param {boolean} [loaded] Only the tabs that are loaded, not the ones
   *   waiting to be restored.
   * @returns {object[]} The tabs showing a YouTube page.
   */
  #youtubeTabs(loaded = true) {
    const found = [];
    for (const win of Services.wm.getEnumerator("navigator:browser")) {
      if (win.closed || !win.gBrowser) {
        continue;
      }
      for (const tab of win.gBrowser.tabs) {
        try {
          if (loaded && tab.hasAttribute("pending")) {
            continue;
          }
          const uri = tab.linkedBrowser?.currentURI;
          if (
            uri &&
            (uri.schemeIs("http") || uri.schemeIs("https")) &&
            lazy.isYouTubeHost(uri.host)
          ) {
            found.push(tab);
          }
        } catch {
          // A tab that is closing, or a page without a host.
        }
      }
    }
    return found;
  }

  #scheduleCheck(delay = CHECK_DELAY_MS) {
    lazy.clearTimeout(this.#checkTimer);
    this.#checkTimer = lazy.setTimeout(() => {
      this.#check().catch(error =>
        console.error("ZenAdblock YouTube extension failed", error)
      );
    }, delay);
  }

  async #check() {
    const selected = this.#selected();
    const started = Services.prefs.getStringPref(PREF_STARTED, "");
    const id = selected || started;
    if (!id) {
      return;
    }
    const addon = await lazy.AddonManager.getAddonByID(id);
    if (!addon) {
      Services.prefs.clearUserPref(PREF_STARTED);
      return;
    }
    const tabs = this.#youtubeTabs();
    const action = decideExtensionAction({
      selected,
      youtubeTabs: tabs.length,
      enabled: !addon.userDisabled,
      started: started === id,
    });
    if (action !== "disable") {
      lazy.clearTimeout(this.#disableTimer);
      this.#disableTimer = null;
    }
    if (action === "enable") {
      Services.prefs.setStringPref(PREF_STARTED, id);
      await addon.enable();
      // The pages that loaded without it get one more load with it.
      lazy.setTimeout(() => {
        for (const tab of this.#youtubeTabs()) {
          tab.linkedBrowser.reload();
        }
      }, RELOAD_DELAY_MS);
    } else if (action === "disable" && !this.#disableTimer) {
      this.#disableTimer = lazy.setTimeout(() => {
        this.#disableTimer = null;
        this.#check().then(() => this.#disableNow(id));
      }, DISABLE_DELAY_MS);
    }
  }

  async #disableNow(id) {
    const addon = await lazy.AddonManager.getAddonByID(id);
    const wanted = this.#selected() === id && this.#youtubeTabs().length;
    if (
      !addon ||
      wanted ||
      addon.userDisabled ||
      Services.prefs.getStringPref(PREF_STARTED, "") !== id
    ) {
      return;
    }
    Services.prefs.clearUserPref(PREF_STARTED);
    await addon.disable();
  }
}

export const gZenAdblockYouTube = new ZenAdblockYouTube();
