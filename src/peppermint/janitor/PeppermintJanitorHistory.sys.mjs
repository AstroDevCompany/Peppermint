/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * What the Janitor has done, for the settings dashboard and for the schedule
 * ("is a run due?"). One small file in the profile; dry runs never appear.
 */

const FILE = "janitor-history.json";
const VERSION = 1;
const MAX_RUNS = 90;
const HOUR_MS = 60 * 60 * 1000;

/** How long after a run the next automatic one is due, per schedule. */
export const SCHEDULE_INTERVAL_MS = Object.freeze({
  daily: 24 * HOUR_MS,
  weekly: 7 * 24 * HOUR_MS,
});

/** The schedules the settings offer; "startup" cleans on every launch. */
export const SCHEDULES = Object.freeze(["startup", "daily", "weekly"]);

let loading = null;
let writeQueue = Promise.resolve();

function historyPath() {
  return PathUtils.join(PathUtils.profileDir, FILE);
}

/**
 * @param {string} schedule - One of SCHEDULES; anything else counts as "startup"
 * @param {number|null} lastRunAt - When the last run finished, ms since epoch
 * @param {number} now
 * @returns {boolean} Whether an automatic run should happen now
 */
export function isRunDue(schedule, lastRunAt, now = Date.now()) {
  const interval = SCHEDULE_INTERVAL_MS[schedule];
  if (!interval) {
    return true;
  }
  return !lastRunAt || now - lastRunAt >= interval;
}

/**
 * @param {object[]} runs - Entries as stored by recordRun
 * @returns {{runs: number, bytes: number, files: number, since: number|null,
 *   lastRun: object|null}}
 */
export function summarizeHistory(runs) {
  let bytes = 0;
  let files = 0;
  for (const run of runs) {
    bytes += run.bytes || 0;
    files += run.files || 0;
  }
  return {
    runs: runs.length,
    bytes,
    files,
    since: runs.length ? runs[0].at : null,
    lastRun: runs.length ? runs[runs.length - 1] : null,
  };
}

function load() {
  loading ??= (async () => {
    try {
      const data = await IOUtils.readJSON(historyPath());
      if (data?.version === VERSION && Array.isArray(data.runs)) {
        return data.runs.filter(run => Number.isFinite(run?.at));
      }
    } catch (error) {
      if (error?.name !== "NotFoundError") {
        console.error("Janitor history could not be read", error);
      }
    }
    return [];
  })();
  return loading;
}

/**
 * @returns {Promise<object[]>} Runs, oldest first
 */
export function getHistory() {
  return load();
}

/**
 * @returns {Promise<number|null>} When the last run happened, ms since epoch
 */
export async function lastRunAt() {
  const runs = await load();
  return runs.length ? runs[runs.length - 1].at : null;
}

/**
 * Remembers a finished run.
 *
 * @param {object} summary - A Janitor RunSummary
 * @param {object} [options]
 * @param {boolean} [options.manual] - The user asked for it
 * @param {number} [options.now]
 * @returns {Promise<void>}
 */
export function recordRun(summary, { manual = false, now = Date.now() } = {}) {
  if (summary.dryRun) {
    return Promise.resolve();
  }
  const entry = {
    at: now,
    manual: !!manual,
    bytes: summary.totalBytes || 0,
    files: summary.groups.reduce((sum, g) => sum + (g.files || 0), 0),
    errors: summary.errors || 0,
    groups: Object.fromEntries(
      summary.groups.map(g => [g.group, { bytes: g.bytes, files: g.files }])
    ),
  };
  const task = writeQueue.then(async () => {
    const runs = await load();
    runs.push(entry);
    while (runs.length > MAX_RUNS) {
      runs.shift();
    }
    await IOUtils.writeJSON(historyPath(), { version: VERSION, runs });
  });
  writeQueue = task.catch(error => {
    console.error("Janitor history could not be written", error);
  });
  return writeQueue;
}

/**
 * Forget what is held in memory so the next call reads the file again. Tests
 * use this after changing the profile directory.
 */
export function resetHistoryForTests() {
  loading = null;
  writeQueue = Promise.resolve();
}
