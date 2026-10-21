// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import {
  isYouTubeHost,
  VIDEO_PAGE_HOOK,
} from "resource:///modules/zen/adblock/ZenAdblockVideo.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  handlePseudoDirective:
    "resource:///modules/zen/adblock/vendor/cosmetics.mjs",
  querySelectorAll: "resource:///modules/zen/adblock/vendor/cosmetics.mjs",
});

const STYLE_ID = "zen-adblock-css";
const SCAN_LIMIT = 2000;
// A page that keeps changing is scanned at most this often. The wait doubles
// while scans find nothing, and after several empty scans in a row the page
// is left alone until the user scrolls again.
const MIN_SCAN_INTERVAL_MS = 1000;
const MAX_SCAN_INTERVAL_MS = 10000;
const MAX_EMPTY_SCANS = 8;
const IDLE_TIMEOUT_MS = 1000;
const MAX_EXTENDED_RULES = 500;
const compiledScripts = new Map();

// Shows up in the Firefox Profiler under "ZenAdblock"; costs next to nothing
// while no profiler is running.
function addMarker(name, start, text) {
  try {
    ChromeUtils.addProfilerMarker("ZenAdblock " + name, start, text);
  } catch {
    // Markers are a diagnostic only.
  }
}

function isHttpUrl(url) {
  return url.startsWith("http:") || url.startsWith("https:");
}

// Each scriptlet carries its own copy of the shared helpers. Run as bare
// global scripts they redeclare each other's top-level bindings and rewire
// helpers onto each other's wrappers, which breaks the page scripts. A
// function scope keeps every scriptlet isolated, as uBlock Origin does.
function compilePageScript(code) {
  let pending = compiledScripts.get(code);
  if (!pending) {
    const wrapped = `(function () {\n${code}\n})();`.toWellFormed();
    pending = ChromeUtils.compileScript(
      "data:text/javascript," + encodeURIComponent(wrapped),
      { filename: "zen-adblock-scriptlet.js" }
    );
    compiledScripts.set(code, pending);
  }
  return pending;
}

// Long-lived pages (feeds, SPAs) keep adding nodes and new class names. Past
// these sizes the bookkeeping is dropped and rebuilt rather than kept forever.
const MAX_PENDING_NODES = 1000;
const MAX_SEEN_ENTRIES = 10000;

/**
 * Applies the cosmetic side of the ad blocker to one document.
 *
 * The site's own rules arrive once, in the hostname reply. After that the
 * document is scanned for the ids, classes and links it contains, so the
 * generic rules for them can be added. Scanning is the costly part, so it is
 * limited to the visible top frame, runs no more than once a second, and
 * stops when it keeps finding nothing. Rules are only ever added, as separate
 * user style sheets, so earlier matches stay and the page is not restyled as
 * a whole each time.
 */
export class ZenAdblockChild extends JSWindowActorChild {
  #sheets = new Set();
  #fallbackStyles = [];
  #extended = new Map();
  #observer = null;
  #scanTimer = 0;
  #idleId = 0;
  #injectedScripts = new Set();
  #seenIds = new Set();
  #seenClasses = new Set();
  #seenHrefs = new Set();
  #hostnameQuery = null;
  #domEnabled = false;
  #destroyed = false;
  #scanning = false;
  #pendingNodes = [];
  #interval = MIN_SCAN_INTERVAL_MS;
  #emptyScans = 0;
  #lastScan = 0;
  #dormant = false;
  #waitingForVisible = false;
  #wakeListening = false;

  handleEvent(event) {
    switch (event.type) {
      case "DOMDocElementInserted":
        this.#precompileVideoHook();
        this.#ensureHostname();
        break;
      case "DOMContentLoaded":
      case "pageshow":
        this.#ensureHostname().then(() => this.#scheduleDomScan());
        break;
      case "visibilitychange":
        this.#onVisibilityChange();
        break;
      case "scroll":
        this.#wake();
        break;
    }
  }

  /**
   * The video hook is only ever injected on YouTube hosts, so compile it
   * ahead of the cosmetics reply there (cached per process) and nowhere else.
   */
  #precompileVideoHook() {
    try {
      if (isYouTubeHost(this.document?.location?.hostname)) {
        compilePageScript(VIDEO_PAGE_HOOK);
      }
    } catch {
      // It is compiled on demand when injected.
    }
  }

  receiveMessage(message) {
    if (message.name === "ZenAdblock:Refresh") {
      this.#resetPage();
      this.#ensureHostname().then(() => this.#scheduleDomScan());
    }
  }

  didDestroy() {
    this.#destroyed = true;
    this.#stopScanning();
    this.#unlisten();
    this.#pendingNodes = [];
  }

  #isTopFrame() {
    const context = this.browsingContext;
    return !!context && context.top === context;
  }

  // Page-state

  /**
   * Back to a clean slate for a list or setting change: the rules in the
   * page are removed and the document is asked about again from the start.
   */
  #resetPage() {
    this.#stopScanning();
    this.#removeStyles();
    this.#extended.clear();
    this.#seenIds.clear();
    this.#seenClasses.clear();
    this.#seenHrefs.clear();
    this.#pendingNodes = [];
    this.#interval = MIN_SCAN_INTERVAL_MS;
    this.#emptyScans = 0;
    this.#dormant = false;
    this.#domEnabled = false;
    this.#hostnameQuery = null;
  }

  #ensureHostname() {
    if (!this.#hostnameQuery) {
      this.#hostnameQuery = this.#applyHostname();
    }
    return this.#hostnameQuery;
  }

  async #applyHostname() {
    if (this.#destroyed) {
      return;
    }
    const doc = this.document;
    if (!doc || doc.nodePrincipal?.isSystemPrincipal) {
      return;
    }
    const url = doc.documentURI || "";
    if (!isHttpUrl(url)) {
      return;
    }
    const start = ChromeUtils.now();
    try {
      const result = await this.sendQuery("ZenAdblock:GetCosmetics", {
        url,
        hostnameOnly: true,
      });
      if (this.#destroyed) {
        return;
      }
      if (!result?.active) {
        this.#removeStyles();
        return;
      }
      // Subframes (mostly ads) get their site's rules but are never scanned.
      this.#domEnabled = !!result.dom && this.#isTopFrame();
      this.#addStyles(result.styles);
      this.#applyExtended(result.extended);
      for (const script of result.scripts || []) {
        if (!script || this.#injectedScripts.has(script)) {
          continue;
        }
        if (await this.#injectScript(script)) {
          this.#injectedScripts.add(script);
        }
      }
    } catch (error) {
      if (!this.#destroyed) {
        console.error("ZenAdblock content apply failed", error);
      }
    } finally {
      addMarker("hostname apply", start);
    }
  }

  // Scanning

  #scheduleDomScan(nodes) {
    if (this.#destroyed || !this.#domEnabled) {
      return;
    }
    if (nodes?.length) {
      for (const node of nodes) {
        this.#pendingNodes.push(node);
      }
      if (this.#pendingNodes.length > MAX_PENDING_NODES) {
        // A burst this large is cheaper to cover with one bounded scan from
        // the root than by holding every node until the page goes idle.
        const root = this.document?.documentElement;
        this.#pendingNodes = root ? [root] : [];
      }
    }
    if (this.#dormant) {
      this.#pendingNodes = [];
      return;
    }
    if (this.document?.hidden) {
      // A tab in the background is not worth the work; it catches up when
      // it is shown.
      this.#pendingNodes = [];
      this.#waitForVisible();
      return;
    }
    if (this.#scanTimer || this.#idleId || this.#scanning) {
      return;
    }
    const win = this.contentWindow;
    if (!win) {
      return;
    }
    const wait = Math.max(0, this.#lastScan + this.#interval - Date.now());
    this.#scanTimer = win.setTimeout(() => {
      this.#scanTimer = 0;
      if (win.requestIdleCallback) {
        this.#idleId = win.requestIdleCallback(
          () => {
            this.#idleId = 0;
            this.#runScan();
          },
          { timeout: IDLE_TIMEOUT_MS }
        );
      } else {
        this.#runScan();
      }
    }, wait);
    this.#watch();
  }

  #watch() {
    if (this.#observer || this.#destroyed) {
      return;
    }
    const doc = this.document;
    const win = this.contentWindow;
    if (!doc?.documentElement || !win?.MutationObserver) {
      return;
    }
    this.#observer = new win.MutationObserver(records => {
      const added = [];
      for (const record of records) {
        for (const node of record.addedNodes) {
          // Our own fallback style element must not wake the scan again.
          if (node.nodeType === 1 && node.id !== STYLE_ID) {
            added.push(node);
          }
        }
      }
      if (added.length) {
        this.#scheduleDomScan(added);
      }
    });
    this.#observer.observe(doc.documentElement, {
      subtree: true,
      childList: true,
    });
  }

  #stopScanning() {
    this.#observer?.disconnect();
    this.#observer = null;
    const win = this.contentWindow;
    if (win && this.#scanTimer) {
      win.clearTimeout(this.#scanTimer);
    }
    if (win && this.#idleId) {
      win.cancelIdleCallback?.(this.#idleId);
    }
    this.#scanTimer = 0;
    this.#idleId = 0;
  }

  async #runScan() {
    if (this.#destroyed || !this.#domEnabled || this.#scanning) {
      return;
    }
    const doc = this.document;
    const url = doc?.documentURI || "";
    if (!doc?.documentElement || !isHttpUrl(url)) {
      return;
    }
    const start = ChromeUtils.now();
    const batch = this.#pendingNodes;
    this.#pendingNodes = [];
    const collected = this.#collect(batch.length ? batch : [doc.documentElement]);
    this.#lastScan = Date.now();
    if (
      !collected.ids.length &&
      !collected.classes.length &&
      !collected.hrefs.length
    ) {
      addMarker("scan", start, "nothing new");
      this.#noteScanResult(false);
      return;
    }
    this.#scanning = true;
    try {
      const result = await this.sendQuery("ZenAdblock:GetCosmetics", {
        url,
        hostnameOnly: false,
        ...collected,
      });
      if (this.#destroyed) {
        return;
      }
      let found = false;
      if (result?.active) {
        if (result.styles) {
          this.#addStyles(result.styles);
          found = true;
        }
        if (result.extended?.length) {
          this.#applyExtended(result.extended);
          found = true;
        }
      }
      this.#noteScanResult(found);
    } catch (error) {
      if (!this.#destroyed) {
        console.error("ZenAdblock content apply failed", error);
      }
    } finally {
      this.#scanning = false;
      addMarker(
        "scan",
        start,
        `${collected.ids.length + collected.classes.length + collected.hrefs.length} names`
      );
      if (!this.#destroyed && this.#pendingNodes.length) {
        this.#scheduleDomScan();
      }
    }
  }

  #noteScanResult(found) {
    if (found) {
      this.#interval = MIN_SCAN_INTERVAL_MS;
      this.#emptyScans = 0;
      return;
    }
    this.#emptyScans++;
    this.#interval = Math.min(this.#interval * 2, MAX_SCAN_INTERVAL_MS);
    if (this.#emptyScans >= MAX_EMPTY_SCANS) {
      this.#goDormant();
    }
  }

  // Nothing has matched for a while: stop watching the page and look again
  // only after the user scrolls, which is when most new content arrives.
  #goDormant() {
    this.#dormant = true;
    this.#stopScanning();
    this.#pendingNodes = [];
    const win = this.contentWindow;
    if (win && !this.#wakeListening) {
      this.#wakeListening = true;
      // Capture, because scrolling inside an element does not bubble.
      win.addEventListener("scroll", this, {
        capture: true,
        passive: true,
        once: true,
      });
    }
  }

  #wake() {
    this.#wakeListening = false;
    if (this.#destroyed || !this.#dormant) {
      return;
    }
    this.#dormant = false;
    this.#emptyScans = 0;
    this.#interval = MIN_SCAN_INTERVAL_MS;
    this.#scheduleDomScan();
  }

  #waitForVisible() {
    if (this.#waitingForVisible) {
      return;
    }
    this.#waitingForVisible = true;
    this.document?.addEventListener("visibilitychange", this);
  }

  #onVisibilityChange() {
    if (this.#destroyed || this.document?.hidden) {
      return;
    }
    this.#waitingForVisible = false;
    this.document?.removeEventListener("visibilitychange", this);
    this.#scheduleDomScan();
  }

  #unlisten() {
    try {
      this.document?.removeEventListener("visibilitychange", this);
      this.contentWindow?.removeEventListener("scroll", this, true);
    } catch {
      // The window is already gone.
    }
  }

  #collect(roots) {
    const ids = [];
    const classes = [];
    const hrefs = [];
    let scanned = 0;
    for (const seen of [this.#seenIds, this.#seenClasses, this.#seenHrefs]) {
      if (seen.size > MAX_SEEN_ENTRIES) {
        seen.clear();
      }
    }
    const visit = el => {
      if (!el || el.nodeType !== 1 || scanned >= SCAN_LIMIT) {
        return;
      }
      scanned++;
      if (el.id && !this.#seenIds.has(el.id)) {
        this.#seenIds.add(el.id);
        ids.push(el.id);
      }
      if (el.classList) {
        for (const name of el.classList) {
          if (!this.#seenClasses.has(name)) {
            this.#seenClasses.add(name);
            classes.push(name);
          }
        }
      }
      const href = el.getAttribute?.("href");
      if (href && !this.#seenHrefs.has(href)) {
        this.#seenHrefs.add(href);
        hrefs.push(href);
      }
      for (const child of el.children) {
        visit(child);
        if (scanned >= SCAN_LIMIT) {
          return;
        }
      }
    };
    for (const root of roots) {
      visit(root);
      if (scanned >= SCAN_LIMIT) {
        break;
      }
    }
    return { ids, classes, hrefs };
  }

  // Applying rules

  /**
   * Adds a style sheet to the document without touching its DOM: the page
   * cannot see it, it does not wake the page's own observers, and adding one
   * does not rewrite the ones before it.
   */
  #addStyles(css) {
    if (!css) {
      return;
    }
    const win = this.contentWindow;
    const uri = "data:text/css;charset=utf-8," + encodeURIComponent(css);
    if (this.#sheets.has(uri)) {
      return;
    }
    try {
      win.windowUtils.loadSheetUsingURIString(
        uri,
        Ci.nsIDOMWindowUtils.USER_SHEET
      );
      this.#sheets.add(uri);
      return;
    } catch {
      // Fall back to a style element below.
    }
    const doc = this.document;
    const style = doc?.createElement("style");
    if (!style) {
      return;
    }
    style.id = STYLE_ID;
    style.textContent = css;
    (doc.head || doc.documentElement).appendChild(style);
    this.#fallbackStyles.push(style);
  }

  #removeStyles() {
    const win = this.contentWindow;
    for (const uri of this.#sheets) {
      try {
        win.windowUtils.removeSheetUsingURIString(
          uri,
          Ci.nsIDOMWindowUtils.USER_SHEET
        );
      } catch {
        // The document is already gone.
      }
    }
    this.#sheets.clear();
    for (const style of this.#fallbackStyles) {
      style.remove();
    }
    this.#fallbackStyles = [];
  }

  /**
   * Procedural filters have to be evaluated against the page itself. Rules
   * from earlier replies are kept, so each pass covers all of them.
   */
  #applyExtended(extended) {
    for (const rule of extended || []) {
      if (!rule?.ast) {
        continue;
      }
      const key = rule.id ?? JSON.stringify(rule.ast);
      if (this.#extended.size < MAX_EXTENDED_RULES || this.#extended.has(key)) {
        this.#extended.set(key, rule);
      }
    }
    if (!this.#extended.size) {
      return;
    }
    const root = this.document?.documentElement;
    if (!root) {
      return;
    }
    for (const rule of this.#extended.values()) {
      let elements = [];
      try {
        elements = lazy.querySelectorAll(root, rule.ast);
      } catch {
        continue;
      }
      for (const element of elements) {
        try {
          if (rule.directive) {
            lazy.handlePseudoDirective(element, rule.directive);
          } else if (rule.attribute) {
            element.setAttribute(rule.attribute, "");
          }
        } catch {
          // One bad procedural filter should not stop the rest.
        }
      }
    }
  }

  async #injectScript(code) {
    const win = this.contentWindow;
    if (!win || !code) {
      return;
    }
    try {
      const script = await compilePageScript(code);
      if (this.#destroyed || this.contentWindow !== win) {
        return false;
      }
      try {
        script.executeInGlobal(win);
      } catch (error) {
        console.error("ZenAdblock scriptlet failed", error);
      }
      return true;
    } catch (error) {
      console.error("ZenAdblock scriptlet failed", error);
      return false;
    }
  }
}
