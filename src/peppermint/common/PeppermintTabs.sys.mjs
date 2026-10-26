/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Hard checks shared by every feature that unloads a tab on its own.
 * Policy (pinned, playing media, glance overlays) stays with the caller.
 *
 * @param {MozTabbrowserTab} tab
 * @param {MozTabbrowserTab} selected - The window's selected tab
 * @returns {boolean} The tab is loaded, off screen, and will not prompt
 */
export function isUnloadSafe(tab, selected) {
  if (
    !tab ||
    tab === selected ||
    tab.closing ||
    !tab.linkedPanel ||
    tab.hasAttribute("pending") ||
    // A load still in flight has an incomplete session entry.
    tab.hasAttribute("busy") ||
    tab.hasAttribute("zen-empty-tab") ||
    tab.hasAttribute("pictureinpicture") ||
    tab.isEmpty
  ) {
    return false;
  }
  const browser = tab.linkedBrowser;
  if (!browser || browser.zenModeActive) {
    return false;
  }
  // Same signal Firefox uses before it would show a beforeunload prompt.
  // Unloading here would raise that prompt on a background tab.
  if (
    browser.isRemoteBrowser &&
    browser.frameLoader &&
    browser.hasBeforeUnload
  ) {
    return false;
  }
  const group = tab.group;
  if (group?.hasAttribute("split-view-group") && selected?.group === group) {
    return false;
  }
  const glanceId = selected?.getAttribute("glance-id");
  return !glanceId || tab.getAttribute("glance-id") !== glanceId;
}

/**
 * @param {MozTabbrowserTab} tab
 * @returns {string} The address the tab shows or, for a tab that was never
 *   loaded, will show; empty when it has none
 */
export function tabUrl(tab) {
  try {
    return tab.linkedBrowser?.currentURI?.spec || "";
  } catch {
    return "";
  }
}

/**
 * Whether a tab may be closed into the archive on its own. Stricter than
 * `isUnloadSafe` about what the tab is (only plain web pages outside folders,
 * Essentials and split views), but it accepts a tab that is already unloaded,
 * the best candidate there is.
 *
 * @param {MozTabbrowserTab} tab
 * @param {MozTabbrowserTab} selected - The window's selected tab
 * @returns {boolean}
 */
export function isArchivable(tab, selected) {
  if (
    !tab ||
    tab === selected ||
    tab.closing ||
    tab.isEmpty ||
    tab.pinned ||
    tab.hasAttribute("busy") ||
    tab.hasAttribute("zen-empty-tab") ||
    tab.hasAttribute("zen-essential") ||
    tab.hasAttribute("zen-glance-tab") ||
    tab.hasAttribute("glance-id") ||
    tab.hasAttribute("zen-live-folder-item-id") ||
    tab.hasAttribute("pictureinpicture") ||
    tab.soundPlaying ||
    tab.hasAttribute("soundplaying")
  ) {
    return false;
  }
  const group = tab.group;
  if (group?.isZenFolder || group?.hasAttribute("split-view-group")) {
    return false;
  }
  const browser = tab.linkedBrowser;
  if (
    tab.linkedPanel &&
    !tab.hasAttribute("pending") &&
    browser?.isRemoteBrowser &&
    browser.frameLoader &&
    browser.hasBeforeUnload
  ) {
    return false;
  }
  return /^https?:/.test(tabUrl(tab));
}
