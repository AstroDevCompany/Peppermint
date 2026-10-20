// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/**
 * Window side of the update notice: the sidebar notification Zen uses after
 * an update, or a toast when the sidebar is collapsed. Imported into one
 * browser window by PeppermintUpdaterUI.sys.mjs.
 */

import createSidebarNotification from "chrome://browser/content/zen-components/ZenSidebarNotification.mjs";

const FTL_FILE = "browser/peppermint-updater.ftl";
const TOAST_TIMEOUT_MS = 12000;

/**
 * @param {object} options
 * @param {"ready"|"manual"} options.kind - What the notice offers.
 * @param {string} options.releasesUrl - Where "what's new" and downloads live.
 * @param {Function} options.install - Called by "Restart to update".
 */
export function showUpdateNotification({ kind, releasesUrl, install }) {
  window.MozXULElement.insertFTLIfNeeded(FTL_FILE);
  const ready = kind == "ready";
  const primary = ready
    ? {
        action: () => install(),
        l10nId: "peppermint-update-restart",
        special: true,
        icon: "chrome://browser/skin/zen-icons/reload.svg",
      }
    : {
        url: releasesUrl,
        l10nId: "peppermint-update-download",
        special: true,
        icon: "chrome://browser/skin/zen-icons/downloads.svg",
      };
  const notification = createSidebarNotification({
    headingL10nId: ready
      ? "peppermint-update-ready-heading"
      : "peppermint-update-available-heading",
    links: [
      primary,
      {
        url: releasesUrl,
        l10nId: "zen-sidebar-notification-updated",
        icon: "chrome://browser/skin/zen-icons/sparkles.svg",
      },
    ],
  });
  if (notification) {
    return;
  }
  // The sidebar is collapsed, so there is nowhere to attach the notification.
  // The About dialog carries the actions.
  window.gZenUIManager?.showToast(
    ready
      ? "peppermint-update-ready-toast"
      : "peppermint-update-available-toast",
    { timeout: TOAST_TIMEOUT_MS }
  );
}
