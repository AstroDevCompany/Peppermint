/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  action,
  showToast,
} from "moz-src:///peppermint/palette/PeppermintPaletteAction.sys.mjs";
import {
  archiveIdleTabs,
  archiveTab,
  canArchiveByHand,
  idleCandidates,
  snoozeTab,
  snoozeTime,
} from "moz-src:///peppermint/tab-archive/PeppermintTabArchive.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
});

const ICONS = "chrome://browser/skin/zen-icons/";

const SNOOZE_PRESETS = [
  { preset: "later", id: "snooze-tab-later" },
  { preset: "tomorrow", id: "snooze-tab-tomorrow" },
  { preset: "next-week", id: "snooze-tab-next-week" },
];

function canArchiveSelected(window) {
  return canArchiveByHand(window, window.gBrowser.selectedTab);
}

function failed(error) {
  console.error("Tab archive action failed", error);
}

function snoozeAction({ preset, id }) {
  return action(
    id,
    `peppermint-action-${id}`,
    `${ICONS}history.svg`,
    window => {
      const wakeAt = snoozeTime(Date.now(), preset);
      snoozeTab(window, window.gBrowser.selectedTab, wakeAt)
        .then(record => {
          if (record) {
            showToast(window, "peppermint-tab-snoozed", {
              time: new Date(wakeAt).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              }),
            });
          }
        })
        .catch(failed);
    },
    canArchiveSelected
  );
}

/**
 * @returns {object[]} Palette entries for the tab archive and snoozing
 */
export function archiveActions() {
  return [
    action(
      "open-tab-archive",
      "peppermint-action-open-tab-archive",
      `${ICONS}history.svg`,
      window => window.openTrustedLinkIn("about:archive", "tab"),
      window => !lazy.PrivateBrowsingUtils.isWindowPrivate(window)
    ),
    action(
      "archive-this-tab",
      "peppermint-action-archive-this-tab",
      `${ICONS}save.svg`,
      window => {
        archiveTab(window, window.gBrowser.selectedTab)
          .then(record => {
            if (record) {
              showToast(window, "peppermint-tab-archived");
            }
          })
          .catch(failed);
      },
      canArchiveSelected
    ),
    action(
      "archive-idle-tabs-now",
      "peppermint-action-archive-idle-tabs-now",
      `${ICONS}trash.svg`,
      window => {
        archiveIdleTabs()
          .then(count =>
            showToast(window, "peppermint-idle-tabs-archived", { count })
          )
          .catch(failed);
      },
      () => !!idleCandidates().length
    ),
    ...SNOOZE_PRESETS.map(snoozeAction),
  ];
}
