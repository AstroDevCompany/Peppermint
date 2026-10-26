// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/**
 * Single entry point for everything Peppermint starts alongside Zen. Zen's
 * ZenStartup calls early() before the layout is built and late() after it, so
 * adding or removing a Peppermint feature never touches Zen's own files.
 */

// Each feature starts independently: one failing never blocks the others.
function start(name, run) {
  try {
    run();
  } catch (error) {
    console.error(`${name} failed to start`, error);
  }
}

const SIDEBAR_STYLE_URL =
  "chrome://browser/content/zen-styles/peppermint-sidebar.css";

const IDLE_STYLE_URL = "chrome://browser/content/zen-styles/peppermint-idle.css";

function loadStyle(window, href) {
  const doc = window.document;
  if (doc.querySelector(`link[href="${href}"]`)) {
    return;
  }
  const link = doc.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  (doc.querySelector("linkset") || doc.documentElement).appendChild(link);
}

export const PeppermintStartup = {
  early() {
    start("ZenTabUnloader", () =>
      ChromeUtils.importESModule(
        "resource:///modules/zen/ZenTabUnloader.sys.mjs"
      ).ZenTabUnloader.start()
    );
    start("Peppermint actions", () =>
      ChromeUtils.importESModule(
        "moz-src:///peppermint/common/PeppermintActions.sys.mjs"
      ).registerPeppermintActions()
    );
  },

  late(window) {
    start("PeppermintActivity", () =>
      ChromeUtils.importESModule(
        "moz-src:///peppermint/common/PeppermintActivity.sys.mjs"
      ).PeppermintActivity.init(window)
    );
    start("Peppermint sidebar styles", () =>
      loadStyle(window, SIDEBAR_STYLE_URL)
    );
    start("Live folders idle", () =>
      ChromeUtils.importESModule(
        "moz-src:///peppermint/common/PeppermintLiveFoldersIdle.sys.mjs"
      ).pauseLiveFoldersWhenInactive()
    );
    start("Peppermint idle styles", () => loadStyle(window, IDLE_STYLE_URL));
    start("Popular sites suggestions", () =>
      ChromeUtils.importESModule(
        "moz-src:///peppermint/urlbar/PeppermintUrlbarProviderPopularSites.sys.mjs"
      ).registerPopularSitesProvider()
    );
    start("Tab search", () =>
      ChromeUtils.importESModule(
        "moz-src:///peppermint/urlbar/PeppermintUrlbarProviderTabSearch.sys.mjs"
      ).registerTabSearchProvider()
    );
    start("Omni utils", () =>
      ChromeUtils.importESModule(
        "moz-src:///peppermint/omni-utils/PeppermintUrlbarProviderOmniUtils.sys.mjs"
      ).registerOmniUtilsProvider()
    );
    start("Tab archive search", () =>
      ChromeUtils.importESModule(
        "moz-src:///peppermint/tab-archive/PeppermintUrlbarProviderArchive.sys.mjs"
      ).registerArchiveProvider()
    );
    start("PeppermintTabArchive", () =>
      ChromeUtils.importESModule(
        "moz-src:///peppermint/tab-archive/PeppermintTabArchive.sys.mjs"
      ).initTabArchive()
    );
    start("PeppermintScreenshotEditor", () =>
      ChromeUtils.importESModule(
        "moz-src:///peppermint/screenshot-editor/PeppermintScreenshotEditor.sys.mjs"
      ).initScreenshotEditor()
    );
    start("Notepad watcher", () =>
      ChromeUtils.importESModule(
        "resource:///actors/ZenNotepadParent.sys.mjs"
      ).watchMintDocuments(window)
    );
    start("ZenCookieConsent", () =>
      ChromeUtils.importESModule(
        "resource:///modules/zen/cookieconsent/ZenCookieConsentManager.sys.mjs"
      ).gZenCookieConsent.init()
    );
    start("PeppermintReader", () =>
      ChromeUtils.importESModule(
        "moz-src:///peppermint/reader/PeppermintReader.sys.mjs"
      ).PeppermintReader.init(window)
    );
    start("ZenUnderpowered", () =>
      ChromeUtils.importESModule(
        "moz-src:///peppermint/underpowered/ZenUnderpowered.sys.mjs"
      ).ZenUnderpowered.init()
    );
    start("PeppermintGhostMode", () =>
      ChromeUtils.importESModule(
        "moz-src:///peppermint/ghost-mode/PeppermintGhostMode.sys.mjs"
      ).PeppermintGhostMode.init()
    );
    start("PeppermintJanitor", () =>
      ChromeUtils.importESModule(
        "moz-src:///peppermint/janitor/PeppermintJanitor.sys.mjs"
      ).PeppermintJanitor.init(window)
    );
    start("PeppermintTabNumbers", () =>
      ChromeUtils.importESModule(
        "moz-src:///peppermint/tab-numbers/PeppermintTabNumbers.sys.mjs"
      ).PeppermintTabNumbers.init(window)
    );
    start("PeppermintTabIslands", () =>
      ChromeUtils.importESModule(
        "moz-src:///peppermint/tab-islands/PeppermintTabIslands.sys.mjs"
      ).PeppermintTabIslands.init(window)
    );
    start("PeppermintShortcutTooltips", () =>
      ChromeUtils.importESModule(
        "moz-src:///peppermint/shortcut-tooltips/PeppermintShortcutTooltips.sys.mjs"
      ).PeppermintShortcutTooltips.init(window)
    );
    start("PeppermintUpdater", () =>
      ChromeUtils.importESModule(
        "moz-src:///peppermint/updater/PeppermintUpdaterUI.sys.mjs"
      ).PeppermintUpdaterUI.init()
    );
    start("PeppermintVault", () =>
      ChromeUtils.importESModule(
        "moz-src:///peppermint/vault/PeppermintVault.sys.mjs"
      ).PeppermintVault.init(window)
    );
  },
};
