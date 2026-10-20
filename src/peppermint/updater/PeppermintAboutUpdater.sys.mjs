// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/**
 * The update line of the About dialog: what the updater is doing and the one
 * button that moves it forward. All state comes from PeppermintUpdater.
 */

import {
  PeppermintUpdater,
  UPDATE_STATE_TOPIC,
  UpdateStatus,
} from "moz-src:///peppermint/updater/PeppermintUpdater.sys.mjs";

export const PeppermintAboutUpdater = {
  /**
   * @param {Window} win - The About dialog window.
   */
  init(win) {
    const doc = win.document;
    const status = doc.getElementById("peppermintUpdateStatus");
    const button = doc.getElementById("peppermintUpdateButton");
    if (!status || !button || !PeppermintUpdater.enabled) {
      return;
    }

    const show = (messageId, args) => {
      status.hidden = !messageId;
      if (messageId) {
        doc.l10n.setAttributes(status, messageId, args);
      }
    };
    const action = (messageId, run) => {
      button.hidden = !messageId;
      button._run = run;
      if (messageId) {
        doc.l10n.setAttributes(button, messageId);
      }
    };

    const render = () => {
      const {
        status: current,
        version,
        url,
        progress,
      } = PeppermintUpdater.state;
      switch (current) {
        case UpdateStatus.CHECKING:
          show("peppermint-update-checking");
          action(null);
          break;
        case UpdateStatus.DOWNLOADING:
          show("peppermint-update-downloading", {
            percent: Math.round((progress ?? 0) * 100),
          });
          action(null);
          break;
        case UpdateStatus.READY:
          show("peppermint-update-ready", { version });
          action("peppermint-update-restart-button", () =>
            PeppermintUpdater.applyAndRestart()
          );
          break;
        case UpdateStatus.MANUAL:
          show("peppermint-update-manual", { version });
          action("peppermint-update-download-button", () =>
            win.openTrustedLinkIn(
              url ?? Services.prefs.getStringPref("app.releaseNotesURL", ""),
              "tab"
            )
          );
          break;
        case UpdateStatus.UP_TO_DATE:
          show("peppermint-update-up-to-date");
          action("peppermint-update-check-button", () =>
            PeppermintUpdater.checkNow()
          );
          break;
        case UpdateStatus.FAILED:
          show("peppermint-update-failed");
          action("peppermint-update-check-button", () =>
            PeppermintUpdater.checkNow()
          );
          break;
        default:
          show(null);
          action("peppermint-update-check-button", () =>
            PeppermintUpdater.checkNow()
          );
      }
    };

    button.addEventListener("command", () => button._run?.());
    const observer = { observe: render };
    Services.obs.addObserver(observer, UPDATE_STATE_TOPIC);
    win.addEventListener(
      "unload",
      () => Services.obs.removeObserver(observer, UPDATE_STATE_TOPIC),
      { once: true }
    );
    render();
  },
};
