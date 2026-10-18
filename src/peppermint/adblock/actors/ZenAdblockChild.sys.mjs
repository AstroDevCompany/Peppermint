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
const QUIET_MS = 15000;
const compiledScripts = new Map();

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

export class ZenAdblockChild extends JSWindowActorChild {
  #style = null;
  #observer = null;
  #timer = 0;
  #quietTimer = 0;
  #idleId = 0;
  #injectedScripts = new Set();
  #seenIds = new Set();
  #seenClasses = new Set();
  #seenHrefs = new Set();
  #hostnameApplied = false;
  #destroyed = false;
  #applying = false;
  #pending = false;
  #pendingNodes = [];

  handleEvent(event) {
    if (
      event.type === "DOMDocElementInserted" ||
      event.type === "DOMContentLoaded" ||
      event.type === "pageshow"
    ) {
      if (event.type === "DOMDocElementInserted") {
        this.#precompileVideoHook();
      }
      this.#apply({ hostnameOnly: !this.#hostnameApplied });
      if (event.type !== "DOMDocElementInserted") {
        this.#scheduleDomScan();
      }
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
      this.#seenIds.clear();
      this.#seenClasses.clear();
      this.#seenHrefs.clear();
      this.#hostnameApplied = false;
      this.#apply({ hostnameOnly: true });
      this.#scheduleDomScan();
    }
  }

  didDestroy() {
    this.#destroyed = true;
    this.#observer?.disconnect();
    this.#observer = null;
    const win = this.contentWindow;
    if (win && this.#timer) {
      win.clearTimeout(this.#timer);
    }
    if (win && this.#quietTimer) {
      win.clearTimeout(this.#quietTimer);
    }
    if (win && this.#idleId) {
      win.cancelIdleCallback?.(this.#idleId);
    }
  }

  #isTopFrame() {
    const context = this.browsingContext;
    return !!context && context.top === context;
  }

  #scheduleDomScan(nodes) {
    if (nodes?.length) {
      this.#pendingNodes.push(...nodes);
      if (this.#pendingNodes.length > MAX_PENDING_NODES) {
        // A burst this large is cheaper to cover with one bounded scan from
        // the root than by holding every node until the page goes idle.
        const root = this.document?.documentElement;
        this.#pendingNodes = root ? [root] : [];
      }
    }
    if (this.#destroyed) {
      return;
    }
    const win = this.contentWindow;
    if (!win) {
      return;
    }
    if (this.#idleId) {
      return;
    }
    const run = () => {
      this.#idleId = 0;
      const batch = this.#pendingNodes;
      this.#pendingNodes = [];
      this.#apply({ nodes: batch.length ? batch : null });
    };
    if (win.requestIdleCallback) {
      this.#idleId = win.requestIdleCallback(run, { timeout: 250 });
    } else {
      this.#timer = win.setTimeout(run, 50);
    }
    this.#armQuietStop(win);
  }

  #armQuietStop(win) {
    if (this.#quietTimer) {
      win.clearTimeout(this.#quietTimer);
    }
    this.#quietTimer = win.setTimeout(() => {
      this.#quietTimer = 0;
      this.#observer?.disconnect();
      this.#observer = null;
    }, QUIET_MS);
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
          if (node.nodeType === 1) {
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
    this.#armQuietStop(win);
  }

  async #apply({ hostnameOnly = false, nodes = null } = {}) {
    if (this.#destroyed) {
      return;
    }
    if (this.#applying) {
      this.#pending = true;
      return;
    }
    const doc = this.document;
    if (!doc || doc.nodePrincipal?.isSystemPrincipal) {
      return;
    }
    const url = doc.documentURI || "";
    if (!url.startsWith("http:") && !url.startsWith("https:")) {
      return;
    }
    const collected = hostnameOnly
      ? { ids: [], classes: [], hrefs: [] }
      : this.#collect(nodes || [doc.documentElement]);
    if (
      !hostnameOnly &&
      !collected.ids.length &&
      !collected.classes.length &&
      !collected.hrefs.length
    ) {
      return;
    }
    this.#applying = true;
    try {
      const result = await this.sendQuery("ZenAdblock:GetCosmetics", {
        url,
        hostnameOnly,
        ...collected,
      });
      if (hostnameOnly) {
        this.#hostnameApplied = true;
      }
      if (this.#destroyed || !result?.active) {
        if (result && !result.active) {
          this.#style?.remove();
          this.#style = null;
        }
        return;
      }
      const hasRules =
        !!result.styles ||
        !!result.scripts?.length ||
        !!result.extended?.length;
      if (!this.#isTopFrame() && !hasRules) {
        this.#observer?.disconnect();
        this.#observer = null;
        return;
      }
      this.#applyStyles(result.styles);
      this.#applyExtended(result.extended);
      if (result.scripts?.length) {
        for (const script of result.scripts) {
          if (!script || this.#injectedScripts.has(script)) {
            continue;
          }
          if (await this.#injectScript(script)) {
            this.#injectedScripts.add(script);
          }
        }
      }
      this.#watch();
    } catch (error) {
      console.error("ZenAdblock content apply failed", error);
    } finally {
      this.#applying = false;
      if (this.#pending && !this.#destroyed) {
        this.#pending = false;
        this.#scheduleDomScan();
      }
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

  #applyStyles(css) {
    const doc = this.document;
    if (!css) {
      this.#style?.remove();
      this.#style = null;
      return;
    }
    if (!this.#style || !this.#style.isConnected) {
      this.#style = doc.createElement("style");
      this.#style.id = STYLE_ID;
      (doc.head || doc.documentElement).appendChild(this.#style);
    }
    if (this.#style.textContent !== css) {
      this.#style.textContent = css;
    }
  }

  #applyExtended(extended) {
    if (!extended?.length) {
      return;
    }
    const root = this.document.documentElement;
    if (!root) {
      return;
    }
    for (const rule of extended) {
      if (!rule?.ast) {
        continue;
      }
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
