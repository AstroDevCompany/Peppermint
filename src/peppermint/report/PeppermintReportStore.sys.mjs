/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Day by day counters for the Peppermint report. They live in
 * `<profile>/peppermint-report.json` as `{ "2026-10-26": { activeMs, banners,
 * unloaded, archived } }`: numbers only, nothing about what was browsed.
 * Callers do not count anything done in a private window.
 */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  clearTimeout: "resource://gre/modules/Timer.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
});

const FILE_NAME = "peppermint-report.json";
const FILE_VERSION = 1;
const WRITE_DELAY_MS = 60 * 1000;
// A year of the report plus some slack; older days are dropped.
const KEEP_DAYS = 400;

export const FIELDS = ["activeMs", "banners", "unloaded", "archived"];

let daysPromise = null;
let writeTimer = null;
let writeQueue = Promise.resolve();
let blockerAdded = false;

function filePath() {
  return PathUtils.join(PathUtils.profileDir, FILE_NAME);
}

/**
 * @param {Date|number} [when]
 * @returns {string} The local calendar day as YYYY-MM-DD
 */
export function dayKey(when = Date.now()) {
  const date = new Date(when);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function emptyBucket() {
  return Object.fromEntries(FIELDS.map(field => [field, 0]));
}

function cleanBucket(raw) {
  const bucket = emptyBucket();
  for (const field of FIELDS) {
    if (Number.isFinite(raw?.[field]) && raw[field] > 0) {
      bucket[field] = Math.floor(raw[field]);
    }
  }
  return bucket;
}

function load() {
  daysPromise ??= (async () => {
    const days = new Map();
    try {
      const data = await IOUtils.readJSON(filePath());
      if (data?.version === FILE_VERSION && data.days) {
        for (const [key, raw] of Object.entries(data.days)) {
          if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
            days.set(key, cleanBucket(raw));
          }
        }
      }
    } catch (error) {
      if (error?.name !== "NotFoundError") {
        console.error("The report counters could not be read", error);
      }
    }
    return days;
  })();
  return daysPromise;
}

function prune(days) {
  if (days.size <= KEEP_DAYS) {
    return;
  }
  const oldest = [...days.keys()].sort().slice(0, days.size - KEEP_DAYS);
  for (const key of oldest) {
    days.delete(key);
  }
}

async function write() {
  const days = await load();
  prune(days);
  const data = { version: FILE_VERSION, days: Object.fromEntries(days) };
  const run = writeQueue.then(() =>
    IOUtils.writeJSON(filePath(), data, { tmpPath: `${filePath()}.tmp` })
  );
  writeQueue = run.catch(() => {});
  return run;
}

function addShutdownBlocker() {
  if (blockerAdded) {
    return;
  }
  blockerAdded = true;
  IOUtils.profileBeforeChange.addBlocker("Peppermint report counters", () =>
    flushReportStore()
  );
}

function scheduleWrite() {
  addShutdownBlocker();
  writeTimer ??= lazy.setTimeout(() => {
    writeTimer = null;
    write().catch(error =>
      console.error("The report counters could not be saved", error)
    );
  }, WRITE_DELAY_MS);
}

/**
 * Add to one of today's counters. Writes to disk are batched.
 *
 * @param {"activeMs"|"banners"|"unloaded"|"archived"} field
 * @param {number} [amount]
 */
export async function bumpReport(field, amount = 1) {
  if (!FIELDS.includes(field) || !(amount > 0)) {
    return;
  }
  const days = await load();
  const key = dayKey();
  const bucket = days.get(key) ?? emptyBucket();
  bucket[field] += Math.floor(amount);
  days.set(key, bucket);
  scheduleWrite();
}

/**
 * @param {string} fromKey - First day, YYYY-MM-DD
 * @param {string} toKey - Last day, YYYY-MM-DD
 * @returns {Promise<{[field: string]: number}>} The counters added up over the
 *   days from `fromKey` to `toKey`
 */
export async function sumReport(fromKey, toKey) {
  const total = emptyBucket();
  for (const [key, bucket] of await load()) {
    if (key >= fromKey && key <= toKey) {
      for (const field of FIELDS) {
        total[field] += bucket[field];
      }
    }
  }
  return total;
}

/**
 * Write the counters now instead of waiting for the next batch.
 */
export async function flushReportStore() {
  if (writeTimer) {
    lazy.clearTimeout(writeTimer);
    writeTimer = null;
  }
  if (daysPromise) {
    await write();
  }
}

/**
 * Forget the in-memory counters so the next call reads the disk again. Tests
 * use this after changing the profile directory.
 */
export function resetReportStoreForTests() {
  daysPromise = null;
  writeTimer = null;
  writeQueue = Promise.resolve();
}
