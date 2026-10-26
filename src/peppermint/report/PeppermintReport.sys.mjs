/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The Peppermint report: what the browser did for the user over a week, a
 * month or a year. Trackers blocked come from Firefox's own protection
 * database, top sites from history; everything else from the day counters in
 * PeppermintReportStore.
 */

import {
  dayKey,
  sumReport,
} from "moz-src:///peppermint/report/PeppermintReportStore.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  PlacesUtils: "resource://gre/modules/PlacesUtils.sys.mjs",
});

export const PERIOD_DAYS = { week: 7, month: 30, year: 365 };
const DAY_MS = 24 * 60 * 60 * 1000;
const TOP_SITES = 5;
// A loaded tab takes in the order of this much memory; unloading frees it. An
// estimate, shown as "about".
const MEMORY_PER_UNLOADED_TAB_MB = 150;

/**
 * @param {number} now - Milliseconds since 1970
 * @param {number} days - Length of the period, today included
 * @returns {{fromMs: number, fromKey: string, toKey: string}} The first
 *   moment (local midnight) and the first and last day of the period
 */
export function periodBounds(now, days) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return {
    fromMs: start.getTime(),
    fromKey: dayKey(start),
    toKey: dayKey(now),
  };
}

/**
 * @param {string} reversedHost - A host as Places stores it ("moc.elpmaxe.")
 * @returns {string} The host ("example.com")
 */
export function hostFromReversed(reversedHost) {
  return Array.from(reversedHost.replace(/\.$/, ""))
    .reverse()
    .join("")
    .replace(/^www\./, "");
}

async function trackersBlocked(fromMs, toMs) {
  try {
    const service = Cc["@mozilla.org/tracking-db-service;1"].getService(
      Ci.nsITrackingDBService
    );
    const rows = await service.getEventsByDateRange(fromMs, toMs);
    return rows.reduce((sum, row) => sum + row.getResultByName("count"), 0);
  } catch (error) {
    console.error("Blocked trackers could not be counted", error);
    return 0;
  }
}

async function topSites(fromMs) {
  try {
    const db = await lazy.PlacesUtils.promiseDBConnection();
    const rows = await db.executeCached(
      `SELECT p.rev_host AS rev_host, COUNT(*) AS visits
       FROM moz_historyvisits v
       JOIN moz_places p ON p.id = v.place_id
       WHERE v.visit_date >= :from AND p.rev_host <> '.' AND p.hidden = 0
         AND (p.url LIKE 'http://%' OR p.url LIKE 'https://%')
       GROUP BY p.rev_host
       ORDER BY visits DESC
       LIMIT :limit`,
      { from: fromMs * 1000, limit: TOP_SITES }
    );
    return rows.map(row => ({
      host: hostFromReversed(row.getResultByName("rev_host")),
      visits: row.getResultByName("visits"),
    }));
  } catch (error) {
    console.error("The top sites could not be read", error);
    return [];
  }
}

/**
 * @param {number} days - Length of the period, today included
 * @param {{now?: number, withHistory?: boolean}} [options]
 * @returns {Promise<object>} `{ days, activeMs, banners, unloaded, archived,
 *   trackers, memoryMb, topSites }`
 */
export async function collectReport(
  days,
  { now = Date.now(), withHistory = true } = {}
) {
  const { fromMs, fromKey, toKey } = periodBounds(now, days);
  const [counters, trackers, sites] = await Promise.all([
    sumReport(fromKey, toKey),
    trackersBlocked(fromMs, now + DAY_MS),
    withHistory ? topSites(fromMs) : [],
  ]);
  return {
    days,
    ...counters,
    trackers,
    memoryMb: counters.unloaded * MEMORY_PER_UNLOADED_TAB_MB,
    topSites: sites,
  };
}
