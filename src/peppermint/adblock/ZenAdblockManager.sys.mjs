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
  // Serialized form of freshly compiled engines, kept only until cached.
  #engineBytes = new WeakMap();

  init() {
    if (this.#initialized || Services.appinfo.inSafeMode) {
      return;
    }
    this.#initialized = true;
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
    lazy.AddonManager.addAddonListener(this.#addonListener);
    this.#loadOverrides();
    this.#refreshUblock().finally(() => {
      this.#uboKnown = true;
      if (!this.#uboActive && Services.prefs.getBoolPref(PREF_ENABLED, true)) {
        this.#ensureEngineWhenIdle();
      }
      this.#notifyUpdated();
    });
  }

  observe(subject, topic, data) {
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
      // Each level has its own cached engine; only the new one may be needed.
      this.#notifyUpdated();
      if (Services.prefs.getBoolPref(PREF_ENABLED, true) && !this.#uboActive) {
        this.ensureEngine(this.getGlobalLevel());
      }
    }
    if (topic === "nsPref:changed" && data === PREF_ENABLED) {
      this.#notifyUpdated();
      if (Services.prefs.getBoolPref(PREF_ENABLED, true) && !this.#uboActive) {
        this.ensureEngine(this.getGlobalLevel());
      }
    }
  }

  getGlobalLevel() {
    const level = Services.prefs.getStringPref(PREF_LEVEL, "medium");
    if (level === "light" || level === "medium" || level === "heavy") {
      return level;
    }
    return "medium";
  }

  isEnabled() {
    return Services.prefs.getBoolPref(PREF_ENABLED, true) && !this.#uboActive;
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
    if (!Services.prefs.getBoolPref(PREF_ENABLED, true) || this.#uboActive) {
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
    const url = browser.currentURI?.spec;
    if (!entry || entry.url !== url) {
      return 0;
    }
    return entry.count;
  }

  getCustomRules() {
    return Services.prefs.getStringPref(PREF_CUSTOM, "");
  }

  setCustomRules(text) {
    Services.prefs.setStringPref(PREF_CUSTOM, text || "");
  }

  updateListsNow() {
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
        if (this.#generation[level] === generation && engine) {
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

  async #buildEngine(level, force) {
    const custom = Services.prefs.getStringPref(PREF_CUSTOM, "");
    const hash = lazy.hashString(custom + "\n" + lazy.LIST_URLS[level].join("\n"));
    const dir = this.#cacheDir();
    const binPath = PathUtils.join(dir, `${level}.bin`);
    const metaPath = PathUtils.join(dir, `${level}.meta.json`);
    if (!force) {
      try {
        const meta = await IOUtils.readJSON(metaPath);
        if (meta?.hash === hash && meta.version === CACHE_VERSION) {
          const bytes = await IOUtils.read(binPath);
          const engine = lazy.deserializeEngine(bytes);
          if (cacheNeedsRefresh(meta, Date.now(), lazy.UPDATE_INTERVAL_MS)) {
            const generation = this.#generation[level];
            this.#fetchAndStore(level, hash, binPath, metaPath).then(fresh => {
              if (fresh && this.#generation[level] === generation) {
                this.#engines[level] = fresh;
                this.#notifyUpdated();
              }
            }).catch(error => {
              console.error("ZenAdblock list refresh failed", error);
            });
          }
          return engine;
        }
      } catch {
        // Cache miss. Build from the network.
      }
    }
    let fresh = null;
    try {
      fresh = await this.#fetchAndStore(level, hash, binPath, metaPath);
    } catch (error) {
      console.error("ZenAdblock list download failed", error);
    }
    if (fresh) {
      return fresh;
    }
    // Offline or every list failed: a stale cache beats no blocking at all.
    try {
      const meta = await IOUtils.readJSON(metaPath);
      if (meta?.version === CACHE_VERSION) {
        return lazy.deserializeEngine(await IOUtils.read(binPath));
      }
    } catch {
      // No usable cache either.
    }
    return null;
  }

  async #fetchAndStore(level, hash, binPath, metaPath) {
    const [lists, resourcesText] = await Promise.all([
      fetchFilterLists(lazy.LIST_URLS[level], url => this.#fetchText(url)),
      this.#fetchText(lazy.RESOURCES_URL).catch(error => {
        console.error("ZenAdblock resources failed", error);
        return "";
      }),
    ]);
    const texts = lists.texts;
    if (!texts.length) {
      return null;
    }
    const custom = Services.prefs.getStringPref(PREF_CUSTOM, "").trim();
    if (custom) {
      texts.push(custom);
    }
    const resources = resourcesText || "";
    const engine = await this.#compileEngine(texts.join("\n"), level, resources);
    try {
      await IOUtils.makeDirectory(this.#cacheDir(), { ignoreExisting: true });
      // The worker already serialized this engine; reuse its bytes instead of
      // serializing again on the main thread.
      await IOUtils.write(binPath, this.#engineBytes.get(engine) || engine.serialize());
      await IOUtils.writeJSON(metaPath, {
        hash,
        updatedAt: Date.now(),
        version: CACHE_VERSION,
        complete: lists.complete,
      });
    } catch (error) {
      console.error("ZenAdblock failed to cache lists", error);
    }
    this.#engineBytes.delete(engine);
    return engine;
  }

  #fetchText(url) {
    const controller = new AbortController();
    const timer = lazy.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    return fetch(url, { signal: controller.signal })
      .then(response => {
        if (!response.ok) {
          throw new Error("HTTP " + response.status);
        }
        return response.text();
      })
      .finally(() => lazy.clearTimeout(timer));
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
    if (this.#decisionCache.size >= 512) {
      const oldest = this.#decisionCache.keys().next().value;
      this.#decisionCache.delete(oldest);
    }
    this.#decisionCache.delete(key);
    this.#decisionCache.set(key, decision);
    return decision;
  }

  #onModifyRequest(channel) {
    if (!Services.prefs.getBoolPref(PREF_ENABLED, true) || this.#uboActive) {
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
    let browser;
    try {
      browser = channel.loadInfo.browsingContext?.top?.embedderElement;
    } catch {
      return;
    }
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
