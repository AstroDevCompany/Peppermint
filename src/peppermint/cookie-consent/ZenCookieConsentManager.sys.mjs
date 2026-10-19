// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

const PREF_ENABLED = "zen.cookie-consent.enabled";
const PAUSED_FILE = "zen-cookie-consent-paused.json";

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

  init() {
    if (this.#initialized || Services.appinfo.inSafeMode) {
      return;
    }
    this.#initialized = true;
    this.#ready = this.#load();
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
    const url = browser.currentURI?.spec || "";
    const entry = this.#counts.get(browser);
    if (!entry || entry.url !== url) {
      this.#counts.set(browser, { url, count: 1 });
      return;
    }
    entry.count++;
  }

  /**
   * @param {Element} browser
   * @returns {number} Banners handled on the page currently shown in `browser`
   */
  getHandledCount(browser) {
    const entry = browser && this.#counts.get(browser);
    if (!entry || entry.url !== browser.currentURI?.spec) {
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
