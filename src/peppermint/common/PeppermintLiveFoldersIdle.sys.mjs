/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  PeppermintActivity: "moz-src:///peppermint/common/PeppermintActivity.sys.mjs",
  ZenLiveFoldersManager:
    "resource:///modules/zen/ZenLiveFoldersManager.sys.mjs",
});

let started = false;

/**
 * Live folders fetch their feeds on a timer, which keeps the network and the
 * session file busy even when nobody is looking. This stops the timers while
 * the browser is inactive. Coming back re-arms each one from the time of its
 * last fetch, so a folder that fell due in the meantime refreshes at once.
 */
export function pauseLiveFoldersWhenInactive() {
  if (started) {
    return;
  }
  started = true;
  lazy.PeppermintActivity.addObserver({
    onInactive() {
      for (const folder of lazy.ZenLiveFoldersManager.liveFolders.values()) {
        folder.stop();
      }
    },
    onActive() {
      for (const folder of lazy.ZenLiveFoldersManager.liveFolders.values()) {
        // stop() first: a fetch that was already running re-armed its timer.
        folder.stop();
        folder.start();
      }
    },
  });
}
