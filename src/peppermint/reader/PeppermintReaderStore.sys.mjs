/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Articles saved for offline reading. They live in `<profile>/reader-offline/`:
 * one `<id>.json` per article (the parsed Reader article, with its images
 * inlined) and an `index.json` with the small records the list page shows, so
 * listing never has to read an article.
 */

import { isSavableUrl } from "moz-src:///peppermint/reader/PeppermintReaderAvailability.sys.mjs";

const DIRECTORY = "reader-offline";
const INDEX_FILE = "index.json";
const INDEX_VERSION = 1;
const ARTICLE_SUFFIX = ".json";
const PREF_MAX_ARTICLE_BYTES = "peppermint.reader.offline.max-article-bytes";
const DEFAULT_MAX_ARTICLE_BYTES = 12 * 1024 * 1024;
const PREF_MAX_TOTAL_BYTES = "peppermint.reader.offline.max-total-bytes";
const DEFAULT_MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 32;

/** Notifies when the saved set changes; the subject is null, data the id. */
export const STORE_CHANGED_TOPIC = "peppermint-reader-store-changed";

export const ID_PATTERN = /^[0-9a-f]{64}$/;

// The article fields Reader Mode reads, plus a few the list shows. Anything
// else the parser returns (such as the plain text copy) only costs space.
const ARTICLE_FIELDS = [
  "url",
  "title",
  "byline",
  "dir",
  "lang",
  "detectedLanguage",
  "content",
  "length",
  "excerpt",
  "siteName",
  "publishedTime",
  "readingTimeMinsSlow",
  "readingTimeMinsFast",
];

let indexPromise = null;
// Index and article writes run one after another, so two saves never
// overwrite each other's index.
let writeQueue = Promise.resolve();

export function storeDirectory() {
  return PathUtils.join(PathUtils.profileDir, DIRECTORY);
}

function indexPath() {
  return PathUtils.join(storeDirectory(), INDEX_FILE);
}

function articlePath(id) {
  if (!ID_PATTERN.test(id)) {
    throw new Error("Invalid saved article id");
  }
  return PathUtils.join(storeDirectory(), `${id}${ARTICLE_SUFFIX}`);
}

/**
 * @param {string} spec
 * @returns {string|null} The URL without its fragment, or null when it is not
 *   a web or file URL
 */
export function normalizeUrl(spec) {
  if (!spec || !isSavableUrl(spec)) {
    return null;
  }
  const url = URL.parse(spec);
  url.hash = "";
  return url.href;
}

/**
 * @param {string} spec
 * @returns {string|null} A stable id for the page, so saving it again
 *   replaces the old copy
 */
export function articleIdFor(spec) {
  const normalized = normalizeUrl(spec);
  if (!normalized) {
    return null;
  }
  const hasher = Cc["@mozilla.org/security/hash;1"].createInstance(
    Ci.nsICryptoHash
  );
  hasher.init(hasher.SHA256);
  const data = new TextEncoder().encode(normalized);
  hasher.update(data, data.length);
  return Array.from(hasher.finish(false), char =>
    char.charCodeAt(0).toString(16).padStart(2, "0")
  ).join("");
}

function idFrom(idOrUrl) {
  return ID_PATTERN.test(idOrUrl) ? idOrUrl : articleIdFor(idOrUrl);
}

function maxArticleBytes() {
  return Services.prefs.getIntPref(
    PREF_MAX_ARTICLE_BYTES,
    DEFAULT_MAX_ARTICLE_BYTES
  );
}

function maxTotalBytes() {
  return Services.prefs.getIntPref(
    PREF_MAX_TOTAL_BYTES,
    DEFAULT_MAX_TOTAL_BYTES
  );
}

/**
 * Cleans up a list of tags: trimmed, lower case, no empty or repeated ones,
 * and no more than the store keeps per article.
 *
 * @param {string[]|string} input - Tags, or a comma separated string of them
 * @returns {string[]}
 */
export function normalizeTags(input) {
  const parts = Array.isArray(input) ? input : String(input ?? "").split(",");
  const tags = [];
  for (const part of parts) {
    const tag = String(part).trim().toLowerCase().slice(0, MAX_TAG_LENGTH);
    if (tag && !tags.includes(tag)) {
      tags.push(tag);
    }
    if (tags.length >= MAX_TAGS) {
      break;
    }
  }
  return tags;
}

/**
 * Chooses which articles to delete so the rest fit in `limit` bytes. Read
 * articles go first, oldest first, then unread ones, oldest first. The
 * article that was just saved is never chosen.
 *
 * @param {object[]} records - Index records
 * @param {number} limit - Bytes the saved articles may take
 * @param {string} [keepId] - An article that has to stay
 * @returns {string[]} Ids to delete
 */
export function pickEvictions(records, limit, keepId = null) {
  let total = records.reduce((sum, record) => sum + (record.bytes || 0), 0);
  if (total <= limit) {
    return [];
  }
  const order = records
    .filter(record => record.id !== keepId)
    .sort(
      (a, b) =>
        Number(!!b.read) - Number(!!a.read) ||
        (a.read ? (a.readAt || a.savedAt) - (b.readAt || b.savedAt) : 0) ||
        a.savedAt - b.savedAt
    );
  const evicted = [];
  for (const record of order) {
    if (total <= limit) {
      break;
    }
    evicted.push(record.id);
    total -= record.bytes || 0;
  }
  return evicted;
}

function isNotFound(error) {
  return error?.name === "NotFoundError";
}

function loadIndex() {
  indexPromise ??= (async () => {
    try {
      const data = await IOUtils.readJSON(indexPath());
      if (data?.version === INDEX_VERSION && Array.isArray(data.articles)) {
        return new Map(
          data.articles
            .filter(entry => ID_PATTERN.test(entry?.id))
            .map(entry => [entry.id, entry])
        );
      }
    } catch (error) {
      if (!isNotFound(error)) {
        console.error("Saved articles index could not be read", error);
      }
    }
    return new Map();
  })();
  return indexPromise;
}

function enqueue(task) {
  const run = writeQueue.then(task);
  writeQueue = run.catch(() => {});
  return run;
}

async function writeIndex(index) {
  await IOUtils.makeDirectory(storeDirectory(), {
    createAncestors: true,
    ignoreExisting: true,
  });
  await IOUtils.writeJSON(
    indexPath(),
    { version: INDEX_VERSION, articles: [...index.values()] },
    { tmpPath: `${indexPath()}.tmp` }
  );
}

function notifyChanged(id) {
  Services.obs.notifyObservers(null, STORE_CHANGED_TOPIC, id || "");
}

function pickArticle(article) {
  const stored = {};
  for (const field of ARTICLE_FIELDS) {
    if (article[field] !== undefined && article[field] !== null) {
      stored[field] = article[field];
    }
  }
  if (article.textPlainDoc) {
    stored.textPlainDoc = true;
  }
  return stored;
}

/**
 * An Error carrying a `code` so callers can tell the user why a save failed.
 *
 * @param {"private"|"unsupported"|"no-content"|"too-large"} code
 * @param {string} message
 * @returns {Error}
 */
function saveError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * Save an article, replacing the copy saved from the same page.
 *
 * @param {object} article - A parsed Reader article whose images are already
 *   inlined (see PeppermintReaderImages)
 * @param {object} [options]
 * @param {boolean} [options.isPrivate] - The article was read in a private
 *   window, which never saves anything
 * @returns {Promise<object>} The index record of the saved article
 */
export async function saveArticle(article, { isPrivate = false } = {}) {
  if (isPrivate) {
    throw saveError("private", "Articles are not saved from private windows");
  }
  const id = articleIdFor(article?.url);
  if (!id) {
    throw saveError("unsupported", "This page cannot be saved");
  }
  if (typeof article.content !== "string" || !article.content.trim()) {
    throw saveError("no-content", "The article has no content");
  }

  const stored = pickArticle(article);
  stored.url = normalizeUrl(article.url);
  stored.title = String(stored.title || stored.url);
  const json = JSON.stringify(stored);
  const bytes = new TextEncoder().encode(json).length;
  if (bytes > maxArticleBytes()) {
    throw saveError("too-large", "The article is too large to save");
  }

  const record = {
    id,
    url: stored.url,
    title: stored.title,
    siteName: stored.siteName || "",
    byline: stored.byline || "",
    excerpt: (stored.excerpt || "").slice(0, 400),
    savedAt: Date.now(),
    bytes,
    readingTimeMinsSlow: stored.readingTimeMinsSlow || 0,
    readingTimeMinsFast: stored.readingTimeMinsFast || 0,
  };

  await enqueue(async () => {
    const index = await loadIndex();
    await IOUtils.makeDirectory(storeDirectory(), {
      createAncestors: true,
      ignoreExisting: true,
    });
    await IOUtils.writeUTF8(articlePath(id), json, {
      tmpPath: `${articlePath(id)}.tmp`,
    });
    // Saving a page again refreshes its content, not what was done with it.
    const previous = index.get(id);
    record.read = !!previous?.read;
    record.readAt = previous?.readAt || 0;
    record.tags = previous?.tags || [];
    index.set(id, record);
    const evicted = pickEvictions([...index.values()], maxTotalBytes(), id);
    for (const evictedId of evicted) {
      index.delete(evictedId);
    }
    await writeIndex(index);
    await Promise.all(
      evicted.map(evictedId =>
        IOUtils.remove(articlePath(evictedId), { ignoreAbsent: true })
      )
    );
  });
  notifyChanged(id);
  return record;
}

/**
 * @param {string} idOrUrl
 * @returns {Promise<object|null>} The saved article in the shape Reader Mode
 *   renders, or null when it is not saved or cannot be read
 */
export async function getArticle(idOrUrl) {
  const id = idFrom(idOrUrl);
  if (!id || !(await loadIndex()).has(id)) {
    return null;
  }
  try {
    const article = await IOUtils.readJSON(articlePath(id));
    return typeof article?.content === "string" ? article : null;
  } catch (error) {
    if (!isNotFound(error)) {
      console.error("Saved article could not be read", error);
    }
    return null;
  }
}

/**
 * @param {string} idOrUrl
 * @returns {Promise<boolean>}
 */
export async function hasArticle(idOrUrl) {
  const id = idFrom(idOrUrl);
  return !!id && (await loadIndex()).has(id);
}

/**
 * @returns {Promise<object[]>} Index records, newest first
 */
export async function listArticles() {
  const index = await loadIndex();
  return [...index.values()].sort((a, b) => b.savedAt - a.savedAt);
}

/**
 * @returns {Promise<number>} Bytes the saved articles take on disk
 */
export async function totalBytes() {
  let total = 0;
  for (const record of (await loadIndex()).values()) {
    total += record.bytes || 0;
  }
  return total;
}

/**
 * @param {string} idOrUrl
 * @returns {Promise<boolean>} An article was removed
 */
export async function removeArticle(idOrUrl) {
  const id = idFrom(idOrUrl);
  if (!id) {
    return false;
  }
  const removed = await enqueue(async () => {
    const index = await loadIndex();
    if (!index.delete(id)) {
      return false;
    }
    await writeIndex(index);
    await IOUtils.remove(articlePath(id), { ignoreAbsent: true });
    return true;
  });
  if (removed) {
    notifyChanged(id);
  }
  return removed;
}

/**
 * Remove every saved article.
 */
export async function clearArticles() {
  await enqueue(async () => {
    const index = await loadIndex();
    const ids = [...index.keys()];
    index.clear();
    await writeIndex(index);
    await Promise.all(
      ids.map(id => IOUtils.remove(articlePath(id), { ignoreAbsent: true }))
    );
  });
  notifyChanged();
}

/**
 * @param {string} idOrUrl
 * @returns {Promise<object|null>} The index record, or null when not saved
 */
export async function getRecord(idOrUrl) {
  const id = idFrom(idOrUrl);
  return (id && (await loadIndex()).get(id)) || null;
}

async function updateRecord(idOrUrl, change) {
  const id = idFrom(idOrUrl);
  if (!id) {
    return false;
  }
  const changed = await enqueue(async () => {
    const index = await loadIndex();
    const record = index.get(id);
    if (!record) {
      return false;
    }
    change(record);
    await writeIndex(index);
    return true;
  });
  if (changed) {
    notifyChanged(id);
  }
  return changed;
}

/**
 * @param {string} idOrUrl
 * @param {boolean} read
 * @returns {Promise<boolean>} The article is saved and was updated
 */
export function setRead(idOrUrl, read) {
  return updateRecord(idOrUrl, record => {
    if (!!record.read === !!read) {
      return;
    }
    record.read = !!read;
    record.readAt = read ? Date.now() : 0;
  });
}

/**
 * @param {string} idOrUrl
 * @param {string[]|string} tags - See normalizeTags
 * @returns {Promise<boolean>} The article is saved and was updated
 */
export function setTags(idOrUrl, tags) {
  return updateRecord(idOrUrl, record => {
    record.tags = normalizeTags(tags);
  });
}

/**
 * @returns {Promise<void>} Resolves once every write started so far finished
 */
export function flushStore() {
  return writeQueue;
}

/**
 * Forget the in-memory index so the next call reads the disk again. Tests use
 * this after changing the profile directory.
 */
export function resetStoreForTests() {
  indexPromise = null;
  writeQueue = Promise.resolve();
}
