// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/**
 * Starts the updater and tells the user, once per version and state, that an
 * update is ready or available. The state itself lives in PeppermintUpdater.
 */

import {
  PeppermintUpdater,
  UPDATE_STATE_TOPIC,
  UpdateStatus,
} from "moz-src:///peppermint/updater/PeppermintUpdater.sys.mjs";

const NOTIFICATION_MODULE =
  "chrome://browser/content/zen-components/PeppermintUpdateNotification.mjs";
const PREF_RELEASES_URL = "app.releaseNotesURL.prompt";

class UpdaterUI {
  #observing = false;
  #announced = new Set();

  init() {
    PeppermintUpdater.init();
    if (this.#observing) {
      return;
    }
    this.#observing = true;
    Services.obs.addObserver(this, UPDATE_STATE_TOPIC);
  }

  observe(subject, topic, status) {
    if (status != UpdateStatus.READY && status != UpdateStatus.MANUAL) {
      return;
    }
    const { version } = PeppermintUpdater.state;
    const key = `${version}:${status}`;
    if (this.#announced.has(key)) {
      return;
    }
    const win = Services.wm.getMostRecentBrowserWindow();
    if (!win || win.closed) {
      return;
    }
    this.#announced.add(key);
    try {
      win.ChromeUtils.importESModule(NOTIFICATION_MODULE, {
        global: "current",
      }).showUpdateNotification({
        kind: status,
        releasesUrl: Services.prefs.getStringPref(PREF_RELEASES_URL, ""),
        install: () => PeppermintUpdater.applyAndRestart(),
      });
    } catch (error) {
      console.error("Peppermint update notification failed", error);
    }
  }
}

export const PeppermintUpdaterUI = new UpdaterUI();
