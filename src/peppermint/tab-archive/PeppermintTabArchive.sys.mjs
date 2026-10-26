/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Tab lifecycle: an idle tab is closed into the archive after
 * `peppermint.tab-archive.hours` (0 turns that off), and a tab can be snoozed
 * until a later time. Both can be opened again from about:archive, in the
 * Space they came from. Pinned tabs, Essentials, folders, split views and
 * private windows are never touched (see `isArchivable`).
 */

import {
  isArchivable,
  tabUrl,
} from "moz-src:///peppermint/common/PeppermintTabs.sys.mjs";
import {
  addRecord,
  dueSnoozes,
  getRecord,
  nextWakeTime,
  removeRecord,
} from "moz-src:///peppermint/tab-archive/PeppermintTabArchiveStore.sys.mjs";
import { bumpReport } from "moz-src:///peppermint/report/PeppermintReportStore.sys.mjs";
import { showToast } from "moz-src:///peppermint/palette/PeppermintPaletteAction.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
});

export const PREF_HOURS = "peppermint.tab-archive.hours";
const DEFAULT_HOURS = 72;
const HOUR_MS = 60 * 60 * 1000;
const FIRST_SWEEP_DELAY_MS = 2 * 60 * 1000;
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
// nsITimer delays are 32-bit; a longer wait is split into several.
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;
const SNOOZE_HOUR_OF_DAY = 9;
const SNOOZE_LATER_HOURS = 3;

let sweepTimer = null;
let wakeTimer = null;
let initialized = false;

function newTimer() {
  return Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
}

function isPrivate(win) {
  return lazy.PrivateBrowsingUtils.isWindowPrivate(win);
}

function browserWindows() {
  return Array.from(Services.wm.getEnumerator("navigator:browser")).filter(
    win => !win.closed && win.gBrowser && !isPrivate(win)
  );
}

function targetWindow(preferred) {
  if (preferred && !preferred.closed && !isPrivate(preferred)) {
    return preferred;
  }
  return lazy.BrowserWindowTracker.getTopWindow({ private: false });
}

/**
 * @param {number} now - Milliseconds since 1970
 * @param {"later"|"tomorrow"|"next-week"} preset
 * @returns {number} When a tab snoozed with the preset comes back: three hours
 *   from now, 9:00 tomorrow, or 9:00 next Monday
 */
export function snoozeTime(now, preset) {
  if (preset == "later") {
    return now + SNOOZE_LATER_HOURS * HOUR_MS;
  }
  const date = new Date(now);
  date.setHours(SNOOZE_HOUR_OF_DAY, 0, 0, 0);
  if (preset == "tomorrow") {
    date.setDate(date.getDate() + 1);
  } else {
    const daysToMonday = (8 - date.getDay()) % 7 || 7;
    date.setDate(date.getDate() + daysToMonday);
  }
  return date.getTime();
}

function archiveHours() {
  return Services.prefs.getIntPref(PREF_HOURS, DEFAULT_HOURS);
}

function workspaceOf(win, tab) {
  const workspaceId = tab.getAttribute("zen-workspace-id") || "";
  let workspaceName = "";
  try {
    workspaceName = workspaceId
      ? win.gZenWorkspaces?.getWorkspaceFromId(workspaceId)?.name || ""
      : "";
  } catch {
    // The Space may be gone already.
  }
  return { workspaceId, workspaceName };
}

/**
 * Whether the user can archive or snooze this tab by hand. Unlike the idle
 * sweep this accepts the selected tab.
 *
 * @param {Window} win
 * @param {MozTabbrowserTab} tab
 * @returns {boolean}
 */
export function canArchiveByHand(win, tab) {
  return !isPrivate(win) && isArchivable(tab, null);
}

async function closeIntoStore(win, tab, extra) {
  const record = await addRecord({
    url: tabUrl(tab),
    title: tab.label || tabUrl(tab),
    ...workspaceOf(win, tab),
    userContextId: tab.userContextId || 0,
    lastAccessed: tab.lastAccessed || 0,
    archivedAt: Date.now(),
    ...extra,
  });
  win.gBrowser.removeTab(tab, { animate: false, skipSessionStore: true });
  bumpReport("archived");
  return record;
}

/**
 * Close a tab into the archive.
 *
 * @param {Window} win
 * @param {MozTabbrowserTab} tab
 * @returns {Promise<object|null>} The record, or null when the tab may not be
 *   archived
 */
export async function archiveTab(win, tab) {
  return canArchiveByHand(win, tab)
    ? closeIntoStore(win, tab, { kind: "archive" })
    : null;
}

/**
 * Close a tab and open it again at `wakeAt`.
 *
 * @param {Window} win
 * @param {MozTabbrowserTab} tab
 * @param {number} wakeAt - Milliseconds since 1970
 * @returns {Promise<object|null>} The record, or null when the tab may not be
 *   snoozed
 */
export async function snoozeTab(win, tab, wakeAt) {
  if (!canArchiveByHand(win, tab)) {
    return null;
  }
  const record = await closeIntoStore(win, tab, { kind: "snooze", wakeAt });
  armWake();
  return record;
}

/**
 * @param {number} [hours] - Defaults to the pref
 * @returns {{win: Window, tab: MozTabbrowserTab}[]} Tabs that sat idle for at
 *   least `hours` and may be archived
 */
export function idleCandidates(hours = archiveHours()) {
  if (hours <= 0) {
    return [];
  }
  const cutoff = Date.now() - hours * HOUR_MS;
  const found = [];
  for (const win of browserWindows()) {
    const selected = win.gBrowser.selectedTab;
    for (const tab of win.gBrowser.tabs) {
      const last = tab.lastAccessed || 0;
      if (last && last <= cutoff && isArchivable(tab, selected)) {
        found.push({ win, tab });
      }
    }
  }
  return found;
}

/**
 * Archive every tab that sat idle long enough.
 *
 * @param {number} [hours] - Defaults to the pref
 * @returns {Promise<number>} How many tabs were archived
 */
export async function archiveIdleTabs(hours) {
  let count = 0;
  for (const { win, tab } of idleCandidates(hours)) {
    try {
      await closeIntoStore(win, tab, { kind: "archive" });
      count++;
    } catch (error) {
      console.error("A tab could not be archived", error);
    }
  }
  return count;
}

/**
 * Open an archived or snoozed tab again, in its Space when that still exists,
 * and take it out of the store.
 *
 * @param {string} id - Record id
 * @param {Window} [preferred] - The window to open it in
 * @param {object} [options]
 * @param {boolean} [options.select] - Switch to the tab; otherwise it opens in
 *   the background
 * @returns {Promise<MozTabbrowserTab|null>} Null when there is no such record
 *   or no window to open it in
 */
export async function restoreRecord(id, preferred, { select = true } = {}) {
  const record = await getRecord(id);
  const win = targetWindow(preferred);
  if (!record || !win) {
    return null;
  }
  let workspaceId;
  try {
    workspaceId = win.gZenWorkspaces?.getWorkspaceFromId(record.workspaceId)
      ? record.workspaceId
      : undefined;
  } catch {
    workspaceId = undefined;
  }
  const tab = win.gBrowser.addTab(record.url, {
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    userContextId: record.userContextId || 0,
    zenWorkspaceId: workspaceId,
    inBackground: !select,
  });
  if (select) {
    win.gBrowser.selectedTab = tab;
  }
  await removeRecord(id);
  return tab;
}

let waking = null;

// Several windows start up together; one pass at a time keeps a snoozed tab
// from coming back twice.
function wakeDueTabs() {
  waking ??= (async () => {
    const due = await dueSnoozes(Date.now());
    for (const record of due) {
      const tab = await restoreRecord(record.id, null, { select: false });
      if (tab) {
        showToast(tab.ownerGlobal, "peppermint-snooze-woke", {
          title: record.title,
        });
      }
    }
    await armWake();
  })().finally(() => {
    waking = null;
  });
  return waking;
}

async function armWake() {
  wakeTimer?.cancel();
  wakeTimer = null;
  const next = await nextWakeTime();
  if (next === null) {
    return;
  }
  const delay = Math.min(MAX_TIMER_DELAY_MS, Math.max(1000, next - Date.now()));
  wakeTimer = newTimer();
  wakeTimer.initWithCallback(
    () => wakeDueTabs().catch(error => console.error("Snooze failed", error)),
    delay,
    Ci.nsITimer.TYPE_ONE_SHOT
  );
}

function armSweep(delay) {
  sweepTimer?.cancel();
  sweepTimer = newTimer();
  sweepTimer.initWithCallback(
    () => {
      ChromeUtils.idleDispatch(async () => {
        try {
          await archiveIdleTabs();
        } catch (error) {
          console.error("Archiving idle tabs failed", error);
        }
        armSweep(SWEEP_INTERVAL_MS);
      });
    },
    delay,
    Ci.nsITimer.TYPE_ONE_SHOT
  );
}

const observer = {
  observe(subject, topic) {
    if (topic == "wake_notification") {
      wakeDueTabs().catch(error => console.error("Snooze failed", error));
    }
  },
};

/**
 * Start the timers once for the process, and bring back snoozed tabs that came
 * due while no window was open.
 */
export function initTabArchive() {
  if (!initialized) {
    initialized = true;
    Services.obs.addObserver(observer, "wake_notification");
    armSweep(FIRST_SWEEP_DELAY_MS);
  }
  wakeDueTabs().catch(error => console.error("Snooze failed", error));
}
