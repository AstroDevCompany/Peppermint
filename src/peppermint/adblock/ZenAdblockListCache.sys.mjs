// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { hashString } from "resource:///modules/zen/adblock/ZenAdblockLists.sys.mjs";

/** How often the background updater wakes up while everything works. */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const RETRY_BASE_MS = 60 * 60 * 1000;
const RETRY_MAX_MS = 24 * 60 * 60 * 1000;

/** A list that was checked this recently is not asked about again. */
export const RECHECK_MIN_MS = 5 * 60 * 1000;

/**
 * Delay until the next background update check. A failed check is retried
 * after an hour, then after twice as long each time, up to a day, so a
 * blocked network or a dead list host is not polled in a loop.
 *
 * @param {number} failures - Consecutive failed checks so far.
 * @returns {number} Milliseconds.
 */
export function nextCheckDelay(failures) {
  if (!failures || failures < 1) {
    return CHECK_INTERVAL_MS;
  }
  return Math.min(RETRY_BASE_MS * 2 ** (failures - 1), RETRY_MAX_MS);
}

/**
 * Asks every list server whether its list changed, and stores the lists that
 * did. A server that answers "not modified", or sends text identical to what
 * is stored, costs no download and no storage write, and does not make the
 * caller rebuild anything.
 *
 * @param {string[]} urls
 * @param {object} options
 * @param {Object<string, {hash: string, etag?: string, lastModified?: string, checkedAt: number}>} options.meta
 *   What is known about each stored list, by URL.
 * @param {(url: string, known: object|null) => Promise<{notModified?: boolean, text?: string, etag?: string, lastModified?: string}>} options.fetchList
 *   Fetches a list. It sends the stored validators when `known` is given.
 * @param {(url: string, text: string) => Promise<void>} options.storeText
 * @param {Iterable<string>} [options.optional] - URLs whose failure does not
 *   make the result incomplete.
 * @param {number} [options.now]
 * @param {number} [options.recheckMs]
 * @returns {Promise<{meta: object, changed: boolean, complete: boolean}>}
 *   `meta` is the new full picture, `changed` whether any stored text changed
 *   and `complete` whether every required list is now up to date.
 */
export async function refreshLists(
  urls,
  {
    meta,
    fetchList,
    storeText,
    optional = [],
    now = Date.now(),
    recheckMs = RECHECK_MIN_MS,
  },
) {
  const optionalUrls = new Set(optional);
  const next = { ...meta };
  let changed = false;
  let complete = true;

  await Promise.all(
    urls.map(async (url) => {
      const known = meta[url] || null;
      if (known && now - (known.checkedAt || 0) < recheckMs) {
        return;
      }
      try {
        const response = await fetchList(url, known);
        if (response.notModified && known) {
          next[url] = { ...known, checkedAt: now };
          return;
        }
        if (!response.text) {
          throw new Error("empty response");
        }
        const hash = hashString(response.text);
        const validators = {
          etag: response.etag || "",
          lastModified: response.lastModified || "",
          checkedAt: now,
        };
        if (known?.hash === hash && known.size === response.text.length) {
          next[url] = { ...known, ...validators };
          return;
        }
        await storeText(url, response.text);
        next[url] = { hash, size: response.text.length, ...validators };
        changed = true;
      } catch (error) {
        console.error("ZenAdblock list failed", url, error);
        if (!optionalUrls.has(url)) {
          complete = false;
        }
      }
    }),
  );
  return { meta: next, changed, complete };
}

/**
 * Identifies the exact stored lists an engine was compiled from, so an engine
 * is only rebuilt when one of them really changed.
 *
 * @param {string[]} urls
 * @param {object} meta
 * @returns {string}
 */
export function listsFingerprint(urls, meta) {
  return hashString(urls.map((url) => meta[url]?.hash || "-").join(","));
}
