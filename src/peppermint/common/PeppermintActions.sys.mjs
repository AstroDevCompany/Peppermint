/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  action,
  isWebPage,
} from "moz-src:///peppermint/palette/PeppermintPaletteAction.sys.mjs";
import { settingsActions } from "moz-src:///peppermint/palette/PeppermintPaletteSettings.sys.mjs";
import { siteActions } from "moz-src:///peppermint/palette/PeppermintPaletteSite.sys.mjs";

const PREF_UNDERPOWERED = "zen.underpowered.enabled";
const PREF_ADBLOCK = "zen.adblock.enabled";

// Share of the screen's usable area (per axis) that "almost maximize" fills.
const ALMOST_MAXIMIZE_RATIO = 0.9;

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  PeppermintReader: "moz-src:///peppermint/reader/PeppermintReader.sys.mjs",
  noteURL: "resource:///modules/zen/notepad/ZenNotepadMarkdown.mjs",
  findNoteIdForUrl: "resource:///modules/zen/notepad/ZenNotepadStore.sys.mjs",
  saveNote: "resource:///modules/zen/notepad/ZenNotepadStore.sys.mjs",
  gZenCookieConsent:
    "resource:///modules/zen/cookieconsent/ZenCookieConsentManager.sys.mjs",
  openTabSearch:
    "moz-src:///peppermint/urlbar/PeppermintUrlbarProviderTabSearch.sys.mjs",
  PeppermintVault: "moz-src:///peppermint/vault/PeppermintVault.sys.mjs",
  PeppermintVaultSession:
    "moz-src:///peppermint/vault/PeppermintVaultSession.sys.mjs",
});

function togglePref(name) {
  Services.prefs.setBoolPref(name, !Services.prefs.getBoolPref(name, false));
}

function cookieConsent() {
  lazy.gZenCookieConsent.init();
  return lazy.gZenCookieConsent;
}

// Window bounds from before "almost maximize", so a second run restores them.
const gRestoreBounds = new WeakMap();

function almostMaximizedBounds(window) {
  const { screen } = window;
  const width = Math.round(screen.availWidth * ALMOST_MAXIMIZE_RATIO);
  const height = Math.round(screen.availHeight * ALMOST_MAXIMIZE_RATIO);
  return {
    x: screen.availLeft + Math.round((screen.availWidth - width) / 2),
    y: screen.availTop + Math.round((screen.availHeight - height) / 2),
    width,
    height,
  };
}

function toggleAlmostMaximize(window) {
  if (window.fullScreen) {
    window.fullScreen = false;
  }
  if (window.windowState == window.STATE_MAXIMIZED) {
    window.restore();
  }
  const target = almostMaximizedBounds(window);
  const saved = gRestoreBounds.get(window);
  const isAlmostMaximized =
    window.screenX == target.x &&
    window.screenY == target.y &&
    window.outerWidth == target.width &&
    window.outerHeight == target.height;
  if (isAlmostMaximized && saved) {
    gRestoreBounds.delete(window);
    window.moveTo(saved.x, saved.y);
    window.resizeTo(saved.width, saved.height);
    return;
  }
  if (!isAlmostMaximized) {
    gRestoreBounds.set(window, {
      x: window.screenX,
      y: window.screenY,
      width: window.outerWidth,
      height: window.outerHeight,
    });
  }
  window.moveTo(target.x, target.y);
  window.resizeTo(target.width, target.height);
}

/**
 * Opens the note about the page being shown, starting one (a heading and a
 * link to the page) the first time.
 *
 * @param {Window} window
 */
async function openNoteAboutPage(window) {
  const url = window.gBrowser.currentURI.spec;
  let id = await lazy.findNoteIdForUrl(url);
  if (!id) {
    id = crypto.randomUUID();
    const title = (window.gBrowser.selectedTab.label || url)
      .replace(/\s+/g, " ")
      .trim();
    await lazy.saveNote(id, `# ${title}\n\n[${title}](${url})\n\n`, null, {
      url,
    });
  }
  window.openTrustedLinkIn(lazy.noteURL(id), "tab");
}

const ACTIONS = [
  action(
    "search-tabs",
    "zen-action-search-tabs",
    "chrome://browser/skin/zen-icons/search-glass.svg",
    window => lazy.openTabSearch(window)
  ),
  action(
    "toggle-underpowered",
    "zen-action-toggle-underpowered",
    "chrome://browser/skin/zen-icons/battery-low.svg",
    () => togglePref(PREF_UNDERPOWERED)
  ),
  action(
    "open-notepad",
    "zen-action-open-notepad",
    "chrome://browser/skin/zen-icons/tab.svg",
    window => {
      window.openTrustedLinkIn(lazy.noteURL(crypto.randomUUID()), "tab");
    }
  ),
  action(
    "note-about-page",
    "zen-action-note-about-page",
    "chrome://browser/skin/zen-icons/tab.svg",
    window =>
      openNoteAboutPage(window).catch(error =>
        console.error("Note about this page failed", error)
      ),
    window => isWebPage(window.gBrowser.currentURI)
  ),
  action(
    "open-notes",
    "zen-action-open-notes",
    "chrome://browser/skin/zen-icons/tab.svg",
    window => window.openTrustedLinkIn("about:notes", "tab")
  ),
  action(
    "open-vault",
    "zen-action-open-vault",
    "chrome://browser/skin/zen-icons/passwords.svg",
    window => window.openTrustedLinkIn("about:vault", "tab"),
    () => lazy.PeppermintVault.isEnabled
  ),
  action(
    "lock-vault",
    "zen-action-lock-vault",
    "chrome://browser/skin/zen-icons/passwords.svg",
    () => lazy.PeppermintVaultSession.lock("manual"),
    () => lazy.PeppermintVault.state === "unlocked"
  ),
  action(
    "toggle-reader-mode",
    "zen-action-toggle-reader-mode",
    "chrome://browser/skin/zen-icons/reader-mode.svg",
    window => window.document.getElementById("View:ReaderView")?.doCommand(),
    window => !window.document.getElementById("reader-mode-button")?.hidden
  ),
  action(
    "save-article-offline",
    "zen-action-save-article-offline",
    "chrome://browser/skin/zen-icons/downloads.svg",
    window => lazy.PeppermintReader.toggleSaveCurrent(window),
    window => lazy.PeppermintReader.canSaveCurrent(window)
  ),
  action(
    "open-saved-articles",
    "zen-action-open-saved-articles",
    "chrome://browser/skin/zen-icons/reader-mode.svg",
    window => lazy.PeppermintReader.openSavedArticles(window)
  ),
  action(
    "manage-url-snippets",
    "zen-action-manage-url-snippets",
    "chrome://browser/skin/zen-icons/link.svg",
    window => window.openPreferences("paneZenUrlSnippets")
  ),
  action(
    "almost-maximize-window",
    "zen-action-almost-maximize-window",
    "chrome://browser/skin/zen-icons/arrows-expand.svg",
    window => toggleAlmostMaximize(window)
  ),
  action(
    "fullscreen-window",
    "zen-action-fullscreen-window",
    "chrome://browser/skin/zen-icons/fullscreen.svg",
    window => window.document.getElementById("View:FullScreen")?.doCommand()
  ),
  action(
    "toggle-adblock",
    "zen-action-toggle-adblock",
    "chrome://browser/skin/zen-icons/extension.svg",
    () => togglePref(PREF_ADBLOCK)
  ),
  action(
    "clear-cookie-exceptions",
    "zen-action-clear-cookie-exceptions",
    "chrome://browser/skin/zen-icons/history.svg",
    () => cookieConsent().clearPaused(),
    () => cookieConsent().hasPaused()
  ),
  ...settingsActions(),
  ...siteActions(),
];

let registered = false;

/**
 * Add Peppermint commands to Zen's command palette. The palette reads
 * `globalActions` on every query, so pushing here is enough.
 */
export function registerPeppermintActions() {
  if (registered) {
    return;
  }
  registered = true;
  const { globalActions } = ChromeUtils.importESModule(
    "resource:///modules/ZenUBGlobalActions.sys.mjs"
  );
  globalActions.push(...ACTIONS);
}

/**
 * @returns {object[]} The actions this module registers
 */
export function peppermintActions() {
  return ACTIONS;
}
