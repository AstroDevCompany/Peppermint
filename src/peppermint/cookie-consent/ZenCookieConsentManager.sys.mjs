// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  clearTimeout: "resource://gre/modules/Timer.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
});

const PREF_ENABLED = "zen.cookie-consent.enabled";
const PREF_STATS_TOTAL = "zen.cookie-consent.stats.handled-total";
const PAUSED_FILE = "zen-cookie-consent-paused.json";
const STATS_FLUSH_MS = 30 * 1000;

function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function siteKeyFromUrl(url) {
  if (!url) {
    return null;
  }
  const spec = typeof url === "string" ? url : url?.spec;
  if (!spec) {
    return null;
  }
  try {
    return Services.eTLD.getBaseDomain(Services.io.newURI(spec));
  } catch {
    const host = hostnameOf(spec);
    return host || null;
  }
}

function isHttpUrl(url) {
  const spec = typeof url === "string" ? url : url?.spec;
  return (
    typeof spec === "string" &&
    (spec.startsWith("http:") || spec.startsWith("https:"))
  );
}

class ZenCookieConsentManager {
  #initialized = false;
  #paused = new Set();
  #counts = new WeakMap();
  #epoch = 0;
  #ready = Promise.resolve();
  #handledTotal = 0;
  #statsTimer = null;

  init() {
    if (this.#initialized || Services.appinfo.inSafeMode) {
      return;
    }
    this.#initialized = true;
    this.#handledTotal = Services.prefs.getIntPref(PREF_STATS_TOTAL, 0);
    Services.obs.addObserver(this, "quit-application");
    this.#ready = this.#load();
  }

  observe() {
    this.#flushStats();
  }

  /** @returns {number} Banners handled so far, over all pages. */
  get handledTotal() {
    this.init();
    return this.#handledTotal;
  }

  #flushStats() {
    if (this.#statsTimer) {
      lazy.clearTimeout(this.#statsTimer);
      this.#statsTimer = null;
    }
    // The pref is a 32 bit integer; stop counting rather than wrap around.
    const total = Math.min(this.#handledTotal, 2147483647);
    if (total !== Services.prefs.getIntPref(PREF_STATS_TOTAL, 0)) {
      Services.prefs.setIntPref(PREF_STATS_TOTAL, total);
    }
  }

  /** Resolves once the stored pauses are loaded (for UI that lists them). */
  get ready() {
    this.init();
    return this.#ready;
  }

  isEnabled() {
    return Services.prefs.getBoolPref(PREF_ENABLED, true);
  }

  isPaused(url) {
    const key = siteKeyFromUrl(url);
    return !!key && this.#paused.has(key);
  }

  async shouldRun(url) {
    this.init();
    await this.#ready;
    if (!this.isEnabled() || !isHttpUrl(url)) {
      return false;
    }
    return !this.isPaused(url);
  }

  hasPaused() {
    return this.#paused.size > 0;
  }

  /**
   * @returns {string[]} Sites (registrable domains) where banners are left alone
   */
  listPaused() {
    return [...this.#paused].sort();
  }

  /**
   * @param {string} site - A registrable domain as listed by listPaused
   */
  unpauseSite(site) {
    if (!this.#paused.delete(site)) {
      return;
    }
    this.#epoch++;
    IOUtils.writeJSON(this.#path(), [...this.#paused]).catch(error => {
      console.error("ZenCookieConsent failed to store pauses", error);
    });
  }

  /**
   * Counts a banner that was refused or hidden on the page shown in `browser`.
   *
   * @param {Element} browser
   */
  noteHandled(browser) {
    if (!browser) {
      return;
    }
    this.init();
    this.#handledTotal++;
    if (!this.#statsTimer) {
      this.#statsTimer = lazy.setTimeout(
        () => this.#flushStats(),
        STATS_FLUSH_MS
      );
    }
    const windowId = this.#currentWindowId(browser);
    const entry = this.#counts.get(browser);
    if (!entry || entry.windowId !== windowId) {
      this.#counts.set(browser, { windowId, count: 1 });
      return;
    }
    entry.count++;
  }

  // The count belongs to one loaded page, so a route change inside a single
  // page application keeps it and a real navigation starts a new one.
  #currentWindowId(browser) {
    try {
      return browser.browsingContext?.currentWindowGlobal?.innerWindowId || 0;
    } catch {
      return 0;
    }
  }

  /**
   * @param {Element} browser
   * @returns {number} Banners handled on the page currently shown in `browser`
   */
  getHandledCount(browser) {
    const entry = browser && this.#counts.get(browser);
    if (!entry || entry.windowId !== this.#currentWindowId(browser)) {
      return 0;
    }
    return entry.count;
  }

  clearPaused() {
    if (!this.#paused.size) {
      return;
    }
    this.#epoch++;
    this.#paused.clear();
    IOUtils.writeJSON(this.#path(), []).catch(error => {
      console.error("ZenCookieConsent failed to store pauses", error);
    });
  }

  setPaused(url, paused) {
    const key = siteKeyFromUrl(url);
    if (!key) {
      return;
    }
    this.#epoch++;
    if (paused) {
      this.#paused.add(key);
    } else {
      this.#paused.delete(key);
    }
    const path = this.#path();
    IOUtils.writeJSON(path, [...this.#paused]).catch(error => {
      console.error("ZenCookieConsent failed to store pauses", error);
    });
  }

  #path() {
    return PathUtils.join(PathUtils.profileDir, PAUSED_FILE);
  }

  async #load() {
    const epoch = this.#epoch;
    let data = [];
    try {
      data = await IOUtils.readJSON(this.#path());
    } catch {
      data = [];
    }
    if (epoch !== this.#epoch || !Array.isArray(data)) {
      return;
    }
    for (const key of data) {
      if (typeof key === "string" && key) {
        this.#paused.add(key);
      }
    }
  }
}

export const gZenCookieConsent = new ZenCookieConsentManager();
