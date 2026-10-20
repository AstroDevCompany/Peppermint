// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  AddonManager: "resource://gre/modules/AddonManager.sys.mjs",
  clearTimeout: "resource://gre/modules/Timer.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
  cosmeticQueryOptions:
    "resource:///modules/zen/adblock/ZenAdblockPolicy.sys.mjs",
  decideNetworkRequest:
    "resource:///modules/zen/adblock/ZenAdblockPolicy.sys.mjs",
  deserializeEngine: "resource:///modules/zen/adblock/ZenAdblockPolicy.sys.mjs",
  parseFilterList: "resource:///modules/zen/adblock/ZenAdblockPolicy.sys.mjs",
  contentPolicyToRequestType:
    "resource:///modules/zen/adblock/ZenAdblockPolicy.sys.mjs",
  shouldInspectNetworkRequest:
    "resource:///modules/zen/adblock/ZenAdblockPolicy.sys.mjs",
  LIST_URLS: "resource:///modules/zen/adblock/ZenAdblockLists.sys.mjs",
  RESOURCES_URL: "resource:///modules/zen/adblock/ZenAdblockLists.sys.mjs",
  UPDATE_INTERVAL_MS: "resource:///modules/zen/adblock/ZenAdblockLists.sys.mjs",
  listsFingerprint:
    "resource:///modules/zen/adblock/ZenAdblockListCache.sys.mjs",
  nextCheckDelay: "resource:///modules/zen/adblock/ZenAdblockListCache.sys.mjs",
  refreshLists: "resource:///modules/zen/adblock/ZenAdblockListCache.sys.mjs",
  CHECK_INTERVAL_MS:
    "resource:///modules/zen/adblock/ZenAdblockListCache.sys.mjs",
  UBLOCK_ORIGIN_ID: "resource:///modules/zen/adblock/ZenAdblockLists.sys.mjs",
  hashString: "resource:///modules/zen/adblock/ZenAdblockLists.sys.mjs",
  needsVideoPageHook: "resource:///modules/zen/adblock/ZenAdblockVideo.sys.mjs",
  isYouTubeHost: "resource:///modules/zen/adblock/ZenAdblockVideo.sys.mjs",
  shouldRewriteVideoAdResponse:
    "resource:///modules/zen/adblock/ZenAdblockVideo.sys.mjs",
  VIDEO_PAGE_HOOK: "resource:///modules/zen/adblock/ZenAdblockVideo.sys.mjs",
  VideoAdStreamListener: "resource:///modules/zen/adblock/ZenAdblockVideo.sys.mjs",
});

const PREF_ENABLED = "zen.adblock.enabled";
const PREF_LEVEL = "zen.adblock.level";
const PREF_CNAME = "zen.adblock.cname-uncloak";
const PREF_CUSTOM = "zen.adblock.customRules";
const CACHE_VERSION = 1;
const TOPIC = "zen-adblock-updated";
const FETCH_TIMEOUT_MS = 20000;
const INVALIDATE_DEBOUNCE_MS = 800;
const CNAME_TIMEOUT_MS = 250;
const INCOMPLETE_RETRY_MS = 60 * 60 * 1000;
const PREF_STATS_TOTAL = "zen.adblock.stats.blocked-total";
const PREF_UNDERPOWERED = "zen.underpowered.enabled";
const STATS_FLUSH_MS = 30 * 1000;
const DECISION_CACHE_SIZE = 2048;
// A busy browser or a low battery postpones the background update check.
const BUSY_RETRY_MS = 60 * 60 * 1000;

/**
 * A cached engine is refreshed in the background once it is older than the
 * normal update interval. A cache written from a partial download retries
 * after an hour. A meta file with no `complete` field counts as complete.
 *
 * @param {object} meta
 * @param {number} now
 * @param {number} updateIntervalMs
 * @returns {boolean}
 */
export function cacheNeedsRefresh(meta, now, updateIntervalMs) {
  const age = now - (meta?.updatedAt || 0);
  if (meta?.complete === false) {
    return age > INCOMPLETE_RETRY_MS;
  }
  return age > updateIntervalMs;
}

/**
 * Download every list at once and keep the original order.
 *
 * @param {string[]} urls
 * @param {(url: string) => Promise<string>} fetchText
 * @returns {Promise<{ texts: string[], complete: boolean }>}
 */
export async function fetchFilterLists(urls, fetchText) {
  const results = await Promise.all(
    urls.map(async url => {
      try {
        return (await fetchText(url)) || "";
      } catch (error) {
        console.error("ZenAdblock list failed", url, error);
        return "";
      }
    })
  );
  return {
    texts: results.filter(Boolean),
    complete: results.length > 0 && results.every(Boolean),
  };
}

const INACTIVE_COSMETICS = {
  active: false,
  styles: "",
  scripts: [],
  extended: [],
};

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
  try {
    return Services.eTLD.getBaseDomain(Services.io.newURI(url));
  } catch {
    const host = hostnameOf(url);
    return host || null;
  }
}

function frameMatchesSite(context, siteKey) {
  let spec = "";
  try {
    spec = context.currentURI?.spec || "";
  } catch {
    return false;
  }
  return siteKeyFromUrl(spec) === siteKey;
}

function isHttpUrl(url) {
  return typeof url === "string" && (url.startsWith("http:") || url.startsWith("https:"));
}

class ZenAdblockManager {
  #initialized = false;
  #engines = { light: null, medium: null, heavy: null };
  #loading = { light: null, medium: null, heavy: null };
  #generation = { light: 0, medium: 0, heavy: 0 };
  #overrides = {};
  #overridesEpoch = 0;
  #counts = new WeakMap();
  #cnameCache = new Map();
  #decisionCache = new Map();
  #uboActive = false;
  #uboKnown = false;
  #addonListener = null;
  #invalidateTimer = null;
  // Mirrors of the two prefs read for every request.
  #enabled = true;
  #level = "medium";
  // Lists are refreshed one level at a time; they share the stored files.
  #listQueue = Promise.resolve();
  #listMeta = null;
  #updateTimer = null;
  #updateFailures = 0;
  #blockedTotal = 0;
  #statsTimer = null;
  // Serialized form of freshly compiled engines, kept only until cached.
  #engineBytes = new WeakMap();

  init() {
    if (this.#initialized || Services.appinfo.inSafeMode) {
      return;
    }
    this.#initialized = true;
    this.#enabled = Services.prefs.getBoolPref(PREF_ENABLED, true);
    this.#level = this.#readLevelPref();
    this.#blockedTotal = Services.prefs.getIntPref(PREF_STATS_TOTAL, 0);
    this.#addonListener = {
      onEnabled: addon => this.#onAddonEvent(addon),
      onDisabled: addon => this.#onAddonEvent(addon),
      onInstalled: addon => this.#onAddonEvent(addon),
      onUninstalled: addon => this.#onAddonEvent(addon, true),
    };
    Services.obs.addObserver(this, "http-on-modify-request");
    Services.obs.addObserver(this, "http-on-examine-response");
    Services.obs.addObserver(this, "http-on-examine-cached-response");
    Services.prefs.addObserver(PREF_ENABLED, this);
    Services.prefs.addObserver(PREF_LEVEL, this);
    Services.prefs.addObserver(PREF_CUSTOM, this);
    Services.obs.addObserver(this, "quit-application");
    lazy.AddonManager.addAddonListener(this.#addonListener);
    this.#loadOverrides();
    this.#refreshUblock().finally(() => {
      this.#uboKnown = true;
      if (!this.#uboActive && Services.prefs.getBoolPref(PREF_ENABLED, true)) {
        this.#ensureEngineWhenIdle();
      }
      this.#notifyUpdated();
    });
    this.#scheduleUpdateCheck(lazy.CHECK_INTERVAL_MS);
  }

  observe(subject, topic, data) {
    if (topic === "quit-application") {
      this.#flushStats();
      return;
    }
    if (topic === "http-on-modify-request") {
      try {
        this.#onModifyRequest(subject.QueryInterface(Ci.nsIHttpChannel));
      } catch (error) {
        console.error("ZenAdblock request failed", error);
      }
      return;
    }
    if (
      topic === "http-on-examine-response" ||
      topic === "http-on-examine-cached-response"
    ) {
      try {
        this.#maybeRewriteVideoResponse(subject);
      } catch (error) {
        console.error("ZenAdblock video rewrite failed", error);
      }
      return;
    }
    if (topic === "nsPref:changed" && data === PREF_CUSTOM) {
      this.#invalidateEngines();
    }
    if (topic === "nsPref:changed" && data === PREF_LEVEL) {
      this.#level = this.#readLevelPref();
      // Each level has its own cached engine; only the new one may be needed.
      this.#notifyUpdated();
      if (this.#enabled && !this.#uboActive) {
        this.ensureEngine(this.getGlobalLevel());
      }
    }
    if (topic === "nsPref:changed" && data === PREF_ENABLED) {
      this.#enabled = Services.prefs.getBoolPref(PREF_ENABLED, true);
      this.#notifyUpdated();
      if (this.#enabled && !this.#uboActive) {
        this.ensureEngine(this.getGlobalLevel());
      }
    }
  }

  #readLevelPref() {
    const level = Services.prefs.getStringPref(PREF_LEVEL, "medium");
    if (level === "light" || level === "medium" || level === "heavy") {
      return level;
    }
    return "medium";
  }

  // The enabled and level prefs are read for every request, so they are
  // mirrored in fields once the observers exist.
  #isOn() {
    return this.#initialized
      ? this.#enabled
      : Services.prefs.getBoolPref(PREF_ENABLED, true);
  }

  getGlobalLevel() {
    return this.#initialized ? this.#level : this.#readLevelPref();
  }

  isEnabled() {
    return this.#isOn() && !this.#uboActive;
  }

  isUblockActive() {
    return this.#uboActive;
  }

  getOverride(url) {
    const key = siteKeyFromUrl(typeof url === "string" ? url : url?.spec);
    if (!key || !Object.hasOwn(this.#overrides, key)) {
      return null;
    }
    return this.#overrides[key];
  }

  /**
   * @returns {{site: string, level: string}[]} Sites with their own blocking
   *   level ("off" means paused), sorted by site
   */
  listOverrides() {
    return Object.entries(this.#overrides)
      .map(([site, level]) => ({ site, level }))
      .sort((a, b) => a.site.localeCompare(b.site));
  }

  /**
   * @param {string} site - A registrable domain as listed by listOverrides
   */
  removeOverrideForSite(site) {
    this.#writeOverride(site, null);
  }

  setOverride(url, level) {
    const key = siteKeyFromUrl(typeof url === "string" ? url : url?.spec);
    this.#writeOverride(key, level);
  }

  #writeOverride(key, level) {
    if (!key) {
      return;
    }
    this.#overridesEpoch++;
    if (level == null) {
      delete this.#overrides[key];
    } else {
      this.#overrides[key] = level;
    }
    const path = this.#overridesPath();
    IOUtils.writeJSON(path, this.#overrides).catch(error => {
      console.error("ZenAdblock failed to store overrides", error);
    });
    this.#notifyUpdated(key);
    if (
      level === "light" ||
      level === "medium" ||
      level === "heavy"
    ) {
      this.ensureEngine(level);
    }
  }

  getEffectiveLevel(url) {
    const spec = typeof url === "string" ? url : url?.spec;
    if (!this.#isOn() || this.#uboActive) {
      return "off";
    }
    const override = this.getOverride(spec);
    if (override) {
      return override;
    }
    return this.getGlobalLevel();
  }

  getBlockedCount(browser) {
    if (!browser) {
      return 0;
    }
    const entry = this.#counts.get(browser);
    if (!entry || entry.windowId !== this.#currentWindowId(browser)) {
      return 0;
    }
    return entry.count;
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

  getCustomRules() {
    return Services.prefs.getStringPref(PREF_CUSTOM, "");
  }

  setCustomRules(text) {
    Services.prefs.setStringPref(PREF_CUSTOM, text || "");
  }

  async updateListsNow() {
    // An explicit request asks the servers even if they were asked a moment ago.
    for (const entry of Object.values(await this.#loadListMeta())) {
      entry.checkedAt = 0;
    }
    const levels = new Set([this.getGlobalLevel()]);
    for (const value of Object.values(this.#overrides)) {
      if (value === "light" || value === "medium" || value === "heavy") {
        levels.add(value);
      }
    }
    return Promise.all(
      [...levels].map(level => this.ensureEngine(level, { force: true }))
    );
  }

  ensureEngine(level, { force = false } = {}) {
    if (level !== "light" && level !== "medium" && level !== "heavy") {
      return Promise.resolve(null);
    }
    if (!force && this.#engines[level]) {
      return Promise.resolve(this.#engines[level]);
    }
    if (!force && this.#loading[level]) {
      return this.#loading[level];
    }
    const generation = ++this.#generation[level];
    const loading = this.#buildEngine(level, force)
      .then(engine => {
        // A failed rebuild (null) keeps the engine that is already blocking.
        if (
          this.#generation[level] === generation &&
          engine &&
          engine !== this.#engines[level]
        ) {
          this.#engines[level] = engine;
          this.#notifyUpdated();
        }
        return this.#engines[level];
      })
      .catch(error => {
        console.error("ZenAdblock failed to load " + level + " lists", error);
        return this.#engines[level];
      })
      .finally(() => {
        if (this.#loading[level] === loading) {
          this.#loading[level] = null;
        }
      });
    this.#loading[level] = loading;
    return loading;
  }

  getCosmetics(data) {
    try {
      if (!data?.url || !isHttpUrl(data.url) || !this.#uboKnown || this.#uboActive) {
        return INACTIVE_COSMETICS;
      }
      const level = this.getEffectiveLevel(data.url);
      if (level === "off") {
        return INACTIVE_COSMETICS;
      }
      const engine = this.#engines[level];
      if (!engine) {
        this.ensureEngine(level);
        if (lazy.needsVideoPageHook(data.url)) {
          return {
            active: true,
            styles: "",
            scripts: [lazy.VIDEO_PAGE_HOOK],
            extended: [],
          };
        }
        return INACTIVE_COSMETICS;
      }
      const cosmeticOptions = lazy.cosmeticQueryOptions(level);
      if (data.hostnameOnly) {
        cosmeticOptions.getRulesFromDOM = false;
      }
      const result = engine.getCosmeticsFilters({
        url: data.url,
        hostname: hostnameOf(data.url),
        domain: siteKeyFromUrl(data.url),
        classes: data.classes || [],
        ids: data.ids || [],
        hrefs: data.hrefs || [],
        ...cosmeticOptions,
      });
      let extended = [];
      if (level === "heavy" && result.extended?.length) {
        try {
          extended = JSON.parse(JSON.stringify(result.extended));
        } catch {
          extended = [];
        }
      }
      const scripts = level === "light" ? [] : (result.scripts || []).slice();
      if (lazy.needsVideoPageHook(data.url)) {
        scripts.unshift(lazy.VIDEO_PAGE_HOOK);
      }
      return {
        active: true,
        styles: result.styles || "",
        scripts,
        extended,
      };
    } catch (error) {
      console.error("ZenAdblock cosmetics failed", error);
      return INACTIVE_COSMETICS;
    }
  }

  #onAddonEvent(addon, removed = false) {
    if (addon?.id !== lazy.UBLOCK_ORIGIN_ID) {
      return;
    }
    if (removed) {
      this.#uboActive = false;
      this.#uboKnown = true;
      this.ensureEngine(this.getGlobalLevel());
      this.#notifyUpdated();
      return;
    }
    this.#refreshUblock().then(() => {
      this.#uboKnown = true;
      this.#notifyUpdated();
    });
  }

  async #refreshUblock() {
    try {
      const addon = await lazy.AddonManager.getAddonByID(lazy.UBLOCK_ORIGIN_ID);
      this.#uboActive = !!addon?.isActive;
    } catch {
      this.#uboActive = false;
    }
  }

  /**
   * Tells already-created content actors to recompute cosmetics. A site key
   * limits the walk to that registrable domain; list and pref changes pass
   * none and refresh every open actor.
   *
   * @param {string|null} [siteKey]
   */
  #notifyUpdated(siteKey = null) {
    this.#decisionCache.clear();
    Services.obs.notifyObservers(null, TOPIC, siteKey || "");
    this.#refreshContentActors(siteKey);
  }

  #refreshContentActors(siteKey) {
    for (const win of Services.wm.getEnumerator("navigator:browser")) {
      if (win.closed || !win.gBrowser) {
        continue;
      }
      let browsers;
      try {
        browsers = win.gBrowser.browsers;
      } catch {
        continue;
      }
      for (const browser of browsers) {
        let contexts;
        try {
          contexts = browser.browsingContext?.getAllBrowsingContextsInSubtree();
        } catch {
          continue;
        }
        if (!contexts) {
          continue;
        }
        for (const context of contexts) {
          if (siteKey && !frameMatchesSite(context, siteKey)) {
            continue;
          }
          let actor;
          try {
            actor = context.currentWindowGlobal?.getExistingActor("ZenAdblock");
          } catch {
            continue;
          }
          try {
            actor?.sendAsyncMessage("ZenAdblock:Refresh");
          } catch {
            // The frame can close between the lookup and the send.
          }
        }
      }
    }
  }

  #ensureEngineWhenIdle() {
    const start = () => {
      ChromeUtils.idleDispatch(() => {
        if (Services.startup.shuttingDown || this.#uboActive) {
          return;
        }
        if (!Services.prefs.getBoolPref(PREF_ENABLED, true)) {
          return;
        }
        this.ensureEngine(this.getGlobalLevel());
      });
    };
    if (!Services.startup.startingUp) {
      start();
      return;
    }
    Services.obs.addObserver(function onDelayed() {
      Services.obs.removeObserver(onDelayed, "browser-delayed-startup-finished");
      start();
    }, "browser-delayed-startup-finished");
  }

  /**
   * Custom rules changed. Loaded engines stay active until their replacement
   * is built, so a slow or failed download never leaves blocking switched off.
   * Typing in the rules box fires many changes; they collapse into one rebuild.
   */
  #invalidateEngines() {
    this.#decisionCache.clear();
    if (this.#invalidateTimer) {
      lazy.clearTimeout(this.#invalidateTimer);
    }
    this.#invalidateTimer = lazy.setTimeout(() => {
      this.#invalidateTimer = null;
      if (!Services.prefs.getBoolPref(PREF_ENABLED, true) || this.#uboActive) {
        this.#engines = { light: null, medium: null, heavy: null };
        return;
      }
      const levels = new Set([this.getGlobalLevel()]);
      for (const level of Object.keys(this.#engines)) {
        if (this.#engines[level]) {
          levels.add(level);
        }
      }
      for (const level of levels) {
        this.ensureEngine(level, { force: true });
      }
    }, INVALIDATE_DEBOUNCE_MS);
  }

  #overridesPath() {
    return PathUtils.join(PathUtils.profileDir, "zen-adblock-overrides.json");
  }

  #cacheDir() {
    return PathUtils.join(PathUtils.profileDir, "zen-adblock");
  }

  async #loadOverrides() {
    const epoch = this.#overridesEpoch;
    let data = {};
    try {
      data = await IOUtils.readJSON(this.#overridesPath());
    } catch {
      data = {};
    }
    if (epoch !== this.#overridesEpoch || !data || typeof data !== "object") {
      return;
    }
    this.#overrides = data;
  }

  async #readEngineMeta(level) {
    try {
      const meta = await IOUtils.readJSON(
        PathUtils.join(this.#cacheDir(), `${level}.meta.json`)
      );
      return meta?.version === CACHE_VERSION ? meta : null;
    } catch {
      return null;
    }
  }

  /**
   * Loads the engine for a level. A cached engine is used at once, and is
   * refreshed in the background when it is stale. `force` asks the list
   * servers again, but an engine is only compiled when a list changed.
   */
  async #buildEngine(level, force) {
    const custom = Services.prefs.getStringPref(PREF_CUSTOM, "");
    const hash = lazy.hashString(custom + "\n" + lazy.LIST_URLS[level].join("\n"));
    const binPath = PathUtils.join(this.#cacheDir(), `${level}.bin`);
    const meta = await this.#readEngineMeta(level);

    let cached = null;
    if (meta?.hash === hash) {
      if (force && this.#engines[level]) {
        cached = this.#engines[level];
      } else {
        try {
          cached = lazy.deserializeEngine(await IOUtils.read(binPath));
        } catch {
          // Missing or unreadable. Rebuild from the stored lists.
        }
      }
    }
    if (cached && !force) {
      if (cacheNeedsRefresh(meta, Date.now(), lazy.UPDATE_INTERVAL_MS)) {
        ChromeUtils.idleDispatch(() => {
          if (!Services.startup.shuttingDown && this.#enabled) {
            this.ensureEngine(level, { force: true });
          }
        });
      }
      return cached;
    }

    let outcome = null;
    try {
      outcome = await this.#refreshEngine(level, hash, {
        meta: cached ? meta : null,
        haveEngine: !!cached,
      });
    } catch (error) {
      console.error("ZenAdblock list download failed", error);
    }
    if (outcome?.engine) {
      return outcome.engine;
    }
    if (outcome?.unchanged) {
      // Nothing changed upstream: keep serving the engine that is loaded.
      return this.#engines[level] || cached;
    }
    // Offline or every list failed: a stale cache beats no blocking at all.
    if (cached) {
      return cached;
    }
    try {
      const stale = await this.#readEngineMeta(level);
      if (stale) {
        return lazy.deserializeEngine(await IOUtils.read(binPath));
      }
    } catch {
      // No usable cache either.
    }
    return null;
  }

  #listsPath() {
    return PathUtils.join(this.#cacheDir(), "lists.json");
  }

  #listTextPath(url) {
    return PathUtils.join(this.#cacheDir(), "lists", `${lazy.hashString(url)}.txt`);
  }

  async #loadListMeta() {
    if (!this.#listMeta) {
      try {
        const data = await IOUtils.readJSON(this.#listsPath());
        this.#listMeta = data && typeof data === "object" ? data : {};
      } catch {
        this.#listMeta = {};
      }
    }
    return this.#listMeta;
  }

  async #fetchList(url, known) {
    const headers = new Headers();
    // The server decides whether the stored copy is still current.
    if (known?.etag) {
      headers.set("If-None-Match", known.etag);
    } else if (known?.lastModified) {
      headers.set("If-Modified-Since", known.lastModified);
    }
    const controller = new AbortController();
    const timer = lazy.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal, headers });
      if (response.status === 304) {
        return { notModified: true };
      }
      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }
      return {
        text: await response.text(),
        etag: response.headers.get("ETag") || "",
        lastModified: response.headers.get("Last-Modified") || "",
      };
    } finally {
      lazy.clearTimeout(timer);
    }
  }

  /**
   * Checks the lists of one level and compiles a new engine only when the
   * lists differ from the ones the cached engine was built from.
   *
   * @returns {Promise<{engine: object|null, unchanged: boolean, complete: boolean}|null>}
   *   null when no list could be loaded at all.
   */
  #refreshEngine(level, hash, { meta, haveEngine }) {
    const run = this.#listQueue.then(() =>
      this.#refreshEngineNow(level, hash, { meta, haveEngine })
    );
    this.#listQueue = run.catch(() => {});
    return run;
  }

  async #refreshEngineNow(level, hash, { meta, haveEngine }) {
    const urls = lazy.LIST_URLS[level];
    const binPath = PathUtils.join(this.#cacheDir(), `${level}.bin`);
    const metaPath = PathUtils.join(this.#cacheDir(), `${level}.meta.json`);
    const known = await this.#loadListMeta();

    await IOUtils.makeDirectory(PathUtils.join(this.#cacheDir(), "lists"), {
      ignoreExisting: true,
    });
    const refreshed = await lazy.refreshLists([...urls, lazy.RESOURCES_URL], {
      meta: known,
      optional: [lazy.RESOURCES_URL],
      fetchList: (url, entry) => this.#fetchList(url, entry),
      storeText: (url, text) => IOUtils.writeUTF8(this.#listTextPath(url), text),
    });
    this.#listMeta = refreshed.meta;
    try {
      await IOUtils.writeJSON(this.#listsPath(), refreshed.meta);
    } catch (error) {
      console.error("ZenAdblock failed to store list state", error);
    }

    if (!urls.some(url => refreshed.meta[url])) {
      return null;
    }
    const listsHash = lazy.listsFingerprint(
      [...urls, lazy.RESOURCES_URL],
      refreshed.meta
    );
    const custom = Services.prefs.getStringPref(PREF_CUSTOM, "").trim();
    if (haveEngine && meta?.hash === hash && meta.listsHash === listsHash) {
      await IOUtils.writeJSON(metaPath, {
        ...meta,
        updatedAt: Date.now(),
        complete: refreshed.complete,
      });
      return { engine: null, unchanged: true, complete: refreshed.complete };
    }

    const texts = [];
    for (const url of urls) {
      try {
        texts.push(await IOUtils.readUTF8(this.#listTextPath(url)));
      } catch {
        // A list that was never stored is skipped.
      }
    }
    if (!texts.length) {
      return null;
    }
    if (custom) {
      texts.push(custom);
    }
    let resources = "";
    try {
      resources = await IOUtils.readUTF8(this.#listTextPath(lazy.RESOURCES_URL));
    } catch {
      // Scriptlet resources are optional.
    }
    const engine = await this.#compileEngine(texts.join("\n"), level, resources);
    try {
      await IOUtils.write(binPath, this.#engineBytes.get(engine) || engine.serialize());
      await IOUtils.writeJSON(metaPath, {
        hash,
        listsHash,
        updatedAt: Date.now(),
        version: CACHE_VERSION,
        complete: refreshed.complete,
      });
    } catch (error) {
      console.error("ZenAdblock failed to cache lists", error);
    }
    this.#engineBytes.delete(engine);
    return { engine, unchanged: false, complete: refreshed.complete };
  }

  // Background updates

  #scheduleUpdateCheck(delay) {
    if (this.#updateTimer) {
      lazy.clearTimeout(this.#updateTimer);
    }
    this.#updateTimer = lazy.setTimeout(() => {
      this.#updateTimer = null;
      ChromeUtils.idleDispatch(() => this.#runScheduledCheck());
    }, delay);
  }

  async #runScheduledCheck() {
    if (Services.startup.shuttingDown) {
      return;
    }
    let delay = lazy.CHECK_INTERVAL_MS;
    if (!this.isEnabled()) {
      this.#scheduleUpdateCheck(delay);
      return;
    }
    if (Services.prefs.getBoolPref(PREF_UNDERPOWERED, false)) {
      // Downloading and compiling lists is real work. Wait for better times.
      this.#scheduleUpdateCheck(BUSY_RETRY_MS);
      return;
    }
    const ok = await this.checkForUpdates();
    this.#updateFailures = ok ? 0 : this.#updateFailures + 1;
    this.#scheduleUpdateCheck(lazy.nextCheckDelay(this.#updateFailures));
  }

  /**
   * Refreshes the engine of every level in use whose lists are older than the
   * update interval. Unchanged lists cost one conditional request each.
   *
   * @returns {Promise<boolean>} Whether every list could be checked.
   */
  async checkForUpdates() {
    const levels = new Set([this.getGlobalLevel()]);
    for (const value of Object.values(this.#overrides)) {
      if (value === "light" || value === "medium" || value === "heavy") {
        levels.add(value);
      }
    }
    let ok = true;
    for (const level of levels) {
      const meta = await this.#readEngineMeta(level);
      if (meta && !cacheNeedsRefresh(meta, Date.now(), lazy.UPDATE_INTERVAL_MS)) {
        continue;
      }
      await this.ensureEngine(level, { force: true });
      const after = await this.#readEngineMeta(level);
      ok = ok && after?.complete !== false;
    }
    return ok;
  }

  /**
   * What the settings page shows about the lists.
   *
   * @returns {Promise<{updatedAt: number, blockedTotal: number}>}
   *   updatedAt is 0 when the lists were never downloaded.
   */
  async getStatus() {
    const meta = await this.#readEngineMeta(this.getGlobalLevel());
    return {
      updatedAt: meta?.updatedAt || 0,
      blockedTotal: this.#blockedTotal,
    };
  }

  #maybeRewriteVideoResponse(subject) {
    if (!this.isEnabled()) {
      return;
    }
    let channel;
    try {
      channel = subject.QueryInterface(Ci.nsIHttpChannel);
    } catch {
      return;
    }
    // Nearly every response is not a YouTube one. A host compare is far
    // cheaper than the URL parse the rewrite policy does.
    try {
      if (!lazy.isYouTubeHost(channel.URI.host)) {
        return;
      }
    } catch {
      return;
    }
    if (channel.responseStatus !== 200) {
      return;
    }
    let spec = "";
    let contentType = "";
    try {
      spec = channel.URI.spec;
      contentType = channel.contentType || "";
    } catch {
      return;
    }
    if (!lazy.shouldRewriteVideoAdResponse(spec, contentType)) {
      return;
    }
    const pageUrl = this.#pageUrl(channel) || spec;
    if (this.getEffectiveLevel(pageUrl) === "off") {
      return;
    }
    try {
      const length = channel.getResponseHeader("Content-Length");
      if (length && Number(length) > 8 * 1024 * 1024) {
        return;
      }
    } catch {
      // Chunked responses omit Content-Length.
    }
    channel.QueryInterface(Ci.nsITraceableChannel);
    new lazy.VideoAdStreamListener(channel);
  }

  #compileEngine(text, level, resources) {
    return new Promise(resolve => {
      let worker;
      try {
        worker = new ChromeWorker(
          "resource:///modules/zen/adblock/ZenAdblockCompiler.worker.mjs",
          { type: "module" }
        );
      } catch (error) {
        console.error("ZenAdblock compiler worker unavailable", error);
        resolve(this.#compileOnMainThread(text, level, resources));
        return;
      }
      const finish = () => {
        try {
          worker.terminate();
        } catch {
          // Already stopped.
        }
      };
      worker.onmessage = event => {
        finish();
        if (!event.data?.ok || !event.data.bytes) {
          resolve(this.#compileOnMainThread(text, level, resources));
          return;
        }
        try {
          const engine = lazy.deserializeEngine(event.data.bytes);
          this.#engineBytes.set(engine, event.data.bytes);
          resolve(engine);
        } catch (error) {
          console.error("ZenAdblock deserialize failed", error);
          resolve(this.#compileOnMainThread(text, level, resources));
        }
      };
      worker.onerror = event => {
        finish();
        console.error("ZenAdblock compiler worker failed", event.message);
        resolve(this.#compileOnMainThread(text, level, resources));
      };
      worker.postMessage({ text, level, resources });
    });
  }

  #compileOnMainThread(text, level, resources) {
    const engine = lazy.parseFilterList(text, level);
    if (resources) {
      try {
        engine.updateResources(resources, String(resources.length));
      } catch {
        // Scriptlet resources are optional.
      }
    }
    return engine;
  }

  #rememberDecision(key, decision) {
    if (this.#decisionCache.size >= DECISION_CACHE_SIZE) {
      const oldest = this.#decisionCache.keys().next().value;
      this.#decisionCache.delete(oldest);
    }
    this.#decisionCache.delete(key);
    this.#decisionCache.set(key, decision);
    return decision;
  }

  #onModifyRequest(channel) {
    if (!this.#isOn() || this.#uboActive) {
      return;
    }
    let uri;
    try {
      uri = channel.URI;
    } catch {
      return;
    }
    if (!uri || (!uri.schemeIs("http") && !uri.schemeIs("https"))) {
      return;
    }
    if (!channel.loadInfo?.browsingContext) {
      return;
    }

    const type = lazy.contentPolicyToRequestType(
      channel.loadInfo.externalContentPolicyType ??
        channel.loadInfo.contentPolicyType
    );
    let isSystem = false;
    let sourceHost = "";
    try {
      const principal = channel.loadInfo.triggeringPrincipal;
      isSystem = !!principal?.isSystemPrincipal;
      if (
        principal?.URI &&
        (principal.URI.schemeIs("http") || principal.URI.schemeIs("https"))
      ) {
        sourceHost = principal.URI.host;
      }
    } catch {
      isSystem = false;
    }
    if (
      !lazy.shouldInspectNetworkRequest({
        type,
        isSystem,
        requestHost: uri.host,
        sourceHost,
      })
    ) {
      return;
    }

    const pageUrl = this.#pageUrl(channel) || uri.spec;
    const level = this.getEffectiveLevel(pageUrl);
    if (level === "off") {
      return;
    }
    const engine = this.#engines[level];
    if (!engine) {
      this.ensureEngine(level);
    }
    const sourceUrl = this.#sourceUrl(channel) || pageUrl;
    const cacheKey = `${level}\n${type}\n${sourceHost}\n${uri.spec}`;
    let decision = this.#decisionCache.get(cacheKey);
    if (decision) {
      this.#decisionCache.delete(cacheKey);
      this.#decisionCache.set(cacheKey, decision);
    } else {
      decision = this.#rememberDecision(
        cacheKey,
        lazy.decideNetworkRequest({
          engine,
          level,
          url: uri.spec,
          sourceUrl,
          type,
        })
      );
    }
    if (decision.action === "cancel" || decision.action === "redirect") {
      this.#applyDecision(channel, decision);
      return;
    }
    if (
      decision.uncloak &&
      level === "heavy" &&
      decision.hostname &&
      engine &&
      Services.prefs.getBoolPref(PREF_CNAME, true)
    ) {
      this.#uncloak(channel, {
        level,
        engine,
        type,
        sourceUrl,
        url: uri.spec,
        hostname: decision.hostname,
      });
    }
  }

  #applyDecision(channel, decision) {
    if (decision.action === "redirect" && decision.url) {
      try {
        channel.redirectTo(Services.io.newURI(decision.url));
        this.#noteBlock(channel);
        return;
      } catch {
        // Fall through to a hard cancel when the channel cannot redirect.
      }
    }
    try {
      channel.cancel(Cr.NS_ERROR_ABORT);
      this.#noteBlock(channel);
    } catch {
      // The channel may already be closed.
    }
  }

  #noteBlock(channel) {
    this.#countBlock();
    let browser;
    let windowId = 0;
    try {
      const context = channel.loadInfo.browsingContext;
      browser = context?.top?.embedderElement;
      // A top-level page's own requests carry the id of the page that is
      // loading them, which is already the new page during a navigation.
      windowId = context?.parent
        ? 0
        : channel.loadInfo.innerWindowID || 0;
    } catch {
      return;
    }
    if (!browser) {
      return;
    }
    windowId ||= this.#currentWindowId(browser);
    const entry = this.#counts.get(browser);
    if (!entry || entry.windowId !== windowId) {
      this.#counts.set(browser, { windowId, count: 1 });
      return;
    }
    entry.count++;
  }

  #countBlock() {
    this.#blockedTotal++;
    if (!this.#statsTimer) {
      this.#statsTimer = lazy.setTimeout(() => this.#flushStats(), STATS_FLUSH_MS);
    }
  }

  #flushStats() {
    if (this.#statsTimer) {
      lazy.clearTimeout(this.#statsTimer);
      this.#statsTimer = null;
    }
    // The pref is a 32 bit integer; stop counting rather than wrap around.
    const total = Math.min(this.#blockedTotal, 2147483647);
    if (total !== Services.prefs.getIntPref(PREF_STATS_TOTAL, 0)) {
      Services.prefs.setIntPref(PREF_STATS_TOTAL, total);
    }
  }

  #pageUrl(channel) {
    try {
      const uri = channel.loadInfo.browsingContext?.top?.currentURI;
      if (uri && (uri.schemeIs("http") || uri.schemeIs("https"))) {
        return uri.spec;
      }
    } catch {
      // Use the source URL instead.
    }
    return this.#sourceUrl(channel);
  }

  #sourceUrl(channel) {
    try {
      const principal = channel.loadInfo?.triggeringPrincipal;
      if (
        principal &&
        !principal.isSystemPrincipal &&
        !principal.isNullPrincipal &&
        principal.URI &&
        (principal.URI.schemeIs("http") || principal.URI.schemeIs("https"))
      ) {
        return principal.URI.spec;
      }
    } catch {
      // No usable principal.
    }
    return null;
  }

  #rememberCname(hostname, cname) {
    if (this.#cnameCache.size > 2048) {
      this.#cnameCache.clear();
    }
    this.#cnameCache.set(hostname, cname || "");
  }

  #uncloak(channel, info) {
    const cached = this.#cnameCache.get(info.hostname);
    const applyCname = cname => {
      if (!cname || cname === info.hostname) {
        return;
      }
      let cnameUrl;
      try {
        cnameUrl = Services.io.newURI(info.url).mutate().setHost(cname).finalize().spec;
      } catch {
        return;
      }
      const decision = lazy.decideNetworkRequest({
        engine: info.engine,
        level: info.level,
        url: cnameUrl,
        sourceUrl: info.sourceUrl,
        type: info.type,
      });
      if (decision.action === "cancel" || decision.action === "redirect") {
        this.#applyDecision(channel, decision);
      }
    };

    if (cached !== undefined) {
      applyCname(cached);
      return;
    }

    let suspended = false;
    let resumed = false;
    const resume = () => {
      if (!suspended || resumed) {
        return;
      }
      resumed = true;
      try {
        channel.resume();
      } catch {
        // Already resumed or cancelled.
      }
    };
    try {
      channel.suspend();
      suspended = true;
    } catch {
      return;
    }
    this.#resolveCname(info.hostname).then(cname => {
      this.#rememberCname(info.hostname, cname);
      try {
        applyCname(cname);
      } finally {
        resume();
      }
    });
  }

  #resolveCname(hostname) {
    return new Promise(resolve => {
      let settled = false;
      const finish = value => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(value || "");
      };
      const timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
      timer.initWithCallback(() => finish(""), CNAME_TIMEOUT_MS, Ci.nsITimer.TYPE_ONE_SHOT);
      try {
        const dns = Cc["@mozilla.org/network/dns-service;1"].getService(
          Ci.nsIDNSService
        );
        const listener = {
          onLookupComplete(_request, record, status) {
            timer.cancel();
            if (!Components.isSuccessCode(status) || !record) {
              finish("");
              return;
            }
            try {
              finish(record.canonicalName);
            } catch {
              finish("");
            }
          },
          QueryInterface: ChromeUtils.generateQI(["nsIDNSListener"]),
        };
        dns.asyncResolve(
          hostname,
          Ci.nsIDNSService.RESOLVE_TYPE_DEFAULT,
          Ci.nsIDNSService.RESOLVE_CANONICAL_NAME,
          null,
          listener,
          Services.tm.currentThread,
          {}
        );
      } catch {
        timer.cancel();
        finish("");
      }
    });
  }
}

export const gZenAdblock = new ZenAdblockManager();
