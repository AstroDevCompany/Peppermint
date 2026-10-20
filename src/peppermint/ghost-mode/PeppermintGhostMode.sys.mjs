/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AsyncShutdown: "resource://gre/modules/AsyncShutdown.sys.mjs",
  Downloads: "resource://gre/modules/Downloads.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
});

const BUTTON_ID = "zen-ghost-mode-button";
const OPEN_ATTRIBUTE = "ghost-open";

const PREF_DELETE_DOWNLOADS = "zen.ghost-mode.delete-downloads";
const PREF_NOTICE_SHOWN = "zen.ghost-mode.notice-shown";

const NOTICE_TOAST_ID = "zen-ghost-mode-notice-toast";
const NOTICE_TOAST_TIMEOUT_MS = 9000;
const NOTICE_DELAY_MS = 600;

const WINDOW_READY_TOPIC = "browser-delayed-startup-finished";
const WINDOW_CLOSED_TOPIC = "domwindowclosed";
const LAST_PRIVATE_CLOSED_TOPIC = "last-pb-context-exited";

/**
 * Everything Ghost Mode adds on top of Firefox private windows. The privacy
 * isolation itself (history, cookies, cache, session restore) is Gecko's; this
 * adds the parts Gecko leaves out: removing downloaded files, saying what the
 * window does and does not protect, and showing that a ghost window is open.
 */
class GhostMode {
  #started = false;

  // Files that finished downloading in a ghost window: {path, size}. The size
  // is checked again before deleting, so a file the user replaced is kept.
  #downloads = new Map();

  #list = null;

  /**
   * @param {Window} win
   * @returns {boolean} Whether the window is a private (Ghost) window.
   */
  isGhostWindow(win) {
    return !!win && lazy.PrivateBrowsingUtils.isWindowPrivate(win);
  }

  init() {
    if (this.#started) {
      return;
    }
    this.#started = true;

    Services.obs.addObserver(this, WINDOW_READY_TOPIC);
    Services.obs.addObserver(this, WINDOW_CLOSED_TOPIC);
    Services.obs.addObserver(this, LAST_PRIVATE_CLOSED_TOPIC);
    lazy.AsyncShutdown.profileBeforeChange.addBlocker(
      "PeppermintGhostMode: delete ghost downloads",
      () => this.deleteDownloads(),
    );

    this.#watchDownloads().catch((error) =>
      console.error("Ghost Mode: download tracking failed", error),
    );
    this.syncButtons();
  }

  observe(subject, topic) {
    switch (topic) {
      case WINDOW_READY_TOPIC:
        this.syncButtons();
        if (this.isGhostWindow(subject)) {
          this.#maybeShowNotice(subject);
        }
        break;
      case WINDOW_CLOSED_TOPIC:
        this.syncButtons(subject);
        break;
      case LAST_PRIVATE_CLOSED_TOPIC:
        this.deleteDownloads().catch((error) =>
          console.error("Ghost Mode: deleting downloads failed", error),
        );
        break;
    }
  }

  // Button state

  /**
   * Counts the open ghost windows.
   *
   * @param {Window} [closing] A window that is closing and must not count.
   * @returns {number}
   */
  openGhostWindowCount(closing = null) {
    let count = 0;
    for (const win of Services.wm.getEnumerator("navigator:browser")) {
      if (win !== closing && !win.closed && this.isGhostWindow(win)) {
        count++;
      }
    }
    return count;
  }

  /**
   * Marks the sidebar button of every normal window while a ghost window is
   * open, so it is obvious that one is running behind the current window.
   *
   * @param {Window} [closing] A window that is closing and must not count.
   */
  syncButtons(closing = null) {
    const open = this.openGhostWindowCount(closing) > 0;
    for (const win of Services.wm.getEnumerator("navigator:browser")) {
      if (!win.closed) {
        this.syncButton(win.document.getElementById(BUTTON_ID), open);
      }
    }
  }

  /**
   * @param {Element|null} node The Ghost Mode button of one window.
   * @param {boolean} [open] Whether a ghost window is open.
   */
  syncButton(node, open = this.openGhostWindowCount() > 0) {
    if (!node) {
      return;
    }
    // The button inside a ghost window itself stays plain. The node may not be
    // in its window yet when it is created, so ask its document.
    const win = node.ownerDocument.defaultView;
    if (open && win && !this.isGhostWindow(win)) {
      node.setAttribute(OPEN_ATTRIBUTE, "true");
    } else {
      node.removeAttribute(OPEN_ATTRIBUTE);
    }
  }

  // One-time notice

  #maybeShowNotice(win) {
    if (Services.prefs.getBoolPref(PREF_NOTICE_SHOWN, false)) {
      return;
    }
    Services.prefs.setBoolPref(PREF_NOTICE_SHOWN, true);
    // The toast container is built after the window finished starting.
    win.setTimeout(() => {
      win.gZenUIManager?.showToast(NOTICE_TOAST_ID, {
        descriptionId: "zen-ghost-mode-notice-toast-description",
        timeout: NOTICE_TOAST_TIMEOUT_MS,
        frosted: true,
      });
    }, NOTICE_DELAY_MS);
  }

  // Downloads

  async #watchDownloads() {
    this.#list = await lazy.Downloads.getList(lazy.Downloads.PRIVATE);
    await this.#list.addView({
      onDownloadChanged: (download) => this.#track(download),
    });
  }

  #track(download) {
    if (!download.succeeded || !download.target?.path) {
      return;
    }
    this.#downloads.set(download.target.path, {
      path: download.target.path,
      size: download.target.size ?? 0,
    });
  }

  /**
   * Number of finished ghost downloads that would be deleted.
   *
   * @returns {number}
   */
  get trackedDownloadCount() {
    return this.#downloads.size;
  }

  /**
   * Deletes the files downloaded in ghost windows, when the setting is on. A
   * file is only removed while it is still a regular file of the size it had
   * when the download finished. The list is forgotten either way, so a later
   * run never touches files from an earlier ghost session.
   *
   * @returns {Promise<number>} How many files were deleted.
   */
  async deleteDownloads() {
    const entries = [...this.#downloads.values()];
    this.#downloads.clear();
    if (!Services.prefs.getBoolPref(PREF_DELETE_DOWNLOADS, false)) {
      return 0;
    }
    let removed = 0;
    for (const { path, size } of entries) {
      try {
        const info = await IOUtils.stat(path);
        if (info.type !== "regular" || (size > 0 && info.size !== size)) {
          continue;
        }
        await IOUtils.remove(path, { ignoreAbsent: true });
        removed++;
      } catch (error) {
        if (error.name !== "NotFoundError") {
          console.error("Ghost Mode: could not delete", path, error);
        }
      }
    }
    return removed;
  }
}

export const PeppermintGhostMode = new GhostMode();
