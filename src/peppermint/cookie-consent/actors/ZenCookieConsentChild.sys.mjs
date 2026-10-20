// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import {
  hideConsent,
  inspectConsent,
  isConsentFrameHost,
  markClicked,
  markManaged,
  nodeMayContainConsent,
} from "resource:///modules/zen/cookieconsent/ZenCookieConsentEngine.sys.mjs";

const MAX_SCANS = 6;
const EXTENDED_SCANS = 16;
const QUIET_MS = 7000;
const HARD_STOP_MS = 8000;
const EXTENDED_STOP_MS = 20000;
const IDLE_TIMEOUT_MS = 300;
// After the first scans find nothing, the page keeps being watched cheaply:
// banners that appear late, or after a route change in a single page app,
// still get handled. Nodes are batched so busy pages cost one check per batch.
const LATE_BATCH_MS = 400;
const LATE_BATCH_NODES = 100;
const MAX_LATE_ACTIVATIONS = 6;

export class ZenCookieConsentChild extends JSWindowActorChild {
  #destroyed = false;
  #done = false;
  #allowed = null;
  #scans = 0;
  #observer = null;
  #timers = [];
  #scanning = false;
  #queued = false;
  #reported = false;
  #doc = null;
  #sawCandidate = false;
  #extended = false;
  #late = false;
  #lateNodes = [];
  #lateTimer = null;
  #lateActivations = 0;

  handleEvent(event) {
    if (event.type !== "DOMContentLoaded" && event.type !== "pageshow") {
      return;
    }
    if (event.type === "pageshow" && event.persisted) {
      this.#doc = null;
    }
    this.#scheduleInitial();
  }

  didDestroy() {
    this.#destroyed = true;
    this.#finish();
  }

  #clearTimers() {
    const pending = this.#timers;
    this.#timers = [];
    for (const cancel of pending) {
      try {
        cancel();
      } catch {
        // The window may already be gone.
      }
    }
  }

  #scheduleInitial() {
    if (this.#destroyed) {
      return;
    }
    const doc = this.document;
    if (!doc || this.#doc === doc) {
      return;
    }
    const win = this.contentWindow;
    if (!win) {
      return;
    }
    this.#clearTimers();
    this.#stopLate();
    this.#observer?.disconnect();
    this.#observer = null;
    this.#lateActivations = 0;
    this.#doc = doc;
    this.#done = false;
    this.#allowed = null;
    this.#scans = 0;
    this.#sawCandidate = false;
    this.#extended = false;
    this.#queued = false;
    this.#reported = false;
    if (!this.#frameShouldRun(doc)) {
      this.#finish();
      return;
    }
    this.#armHardStop(win);
    const run = () => this.#scan();
    // The idle callback already has a timeout, so a second timer would only
    // schedule the same first scan twice.
    if (win.requestIdleCallback) {
      const id = win.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
      this.#timers.push(() => win.cancelIdleCallback?.(id));
    } else {
      const timer = win.setTimeout(run, IDLE_TIMEOUT_MS);
      this.#timers.push(() => win.clearTimeout(timer));
    }
  }

  #armHardStop(win) {
    const timer = win.setTimeout(() => {
      if (this.#sawCandidate) {
        return;
      }
      this.#finish({ keepWatching: true });
    }, HARD_STOP_MS);
    this.#timers.push(() => win.clearTimeout(timer));
  }

  #extendWatch(win) {
    if (this.#extended || !win) {
      return;
    }
    this.#extended = true;
    const timer = win.setTimeout(() => this.#finish(), EXTENDED_STOP_MS);
    this.#timers.push(() => win.clearTimeout(timer));
  }

  #schedule(delay) {
    if (this.#destroyed || this.#done) {
      return;
    }
    const win = this.contentWindow;
    if (!win) {
      return;
    }
    const timer = win.setTimeout(() => this.#scan(), delay);
    this.#timers.push(() => win.clearTimeout(timer));
  }

  #armQuietStop() {
    if (this.#sawCandidate || this.#done) {
      return;
    }
    const win = this.contentWindow;
    if (!win) {
      return;
    }
    const timer = win.setTimeout(() => {
      if (!this.#sawCandidate) {
        this.#finish({ keepWatching: true });
      }
    }, QUIET_MS);
    this.#timers.push(() => win.clearTimeout(timer));
  }

  #isTopFrame() {
    const context = this.browsingContext;
    return !!context && context.top === context;
  }

  /**
   * Banners live in the top document. Subframes only run for hosts that
   * embed a known consent manager, so ordinary ad and widget frames do not
   * start the scanner.
   */
  #frameShouldRun(doc) {
    if (this.#isTopFrame()) {
      return true;
    }
    try {
      return isConsentFrameHost(new URL(doc.documentURI).hostname);
    } catch {
      return false;
    }
  }

  #watch(doc) {
    if (this.#observer || !this.#isTopFrame() || this.#done) {
      return;
    }
    const win = this.contentWindow;
    if (!doc?.documentElement || !win?.MutationObserver) {
      return;
    }
    this.#observer = new win.MutationObserver(records => {
      if (this.#late) {
        this.#bufferLate(records);
        return;
      }
      if (this.#done || this.#scans >= EXTENDED_SCANS) {
        return;
      }
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType !== 1) {
            continue;
          }
          let matched = false;
          try {
            matched = nodeMayContainConsent(node);
          } catch {
            matched = false;
          }
          if (matched) {
            this.#schedule(150);
            return;
          }
        }
      }
    });
    this.#observer.observe(doc.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  async #scan() {
    if (this.#destroyed || this.#done) {
      return;
    }
    if (this.#scanning) {
      this.#queued = true;
      return;
    }
    this.#scanning = true;
    try {
      await this.#scanOnce();
    } finally {
      this.#scanning = false;
      if (this.#queued && !this.#done && !this.#destroyed) {
        this.#queued = false;
        this.#scan();
      }
    }
  }

  async #scanOnce() {
    const limit = this.#sawCandidate ? EXTENDED_SCANS : MAX_SCANS;
    if (this.#scans >= limit) {
      this.#finish();
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
    if (this.#allowed === null) {
      try {
        const result = await this.sendQuery("ZenCookieConsent:ShouldRun", { url });
        this.#allowed = !!result?.run;
      } catch {
        this.#finish();
        return;
      }
      if (!this.#allowed) {
        this.#finish();
        return;
      }
    }
    if (this.#destroyed || this.#done) {
      return;
    }
    this.#scans++;
    const topFrame = this.#isTopFrame();
    const decision = inspectConsent(doc, { topFrame });
    if (decision.action === "none") {
      if (!topFrame && !this.#sawCandidate) {
        this.#finish();
        return;
      }
      if (this.#sawCandidate) {
        this.#watch(doc);
        this.#schedule(500);
        return;
      }
      this.#watch(doc);
      this.#armQuietStop();
      return;
    }
    this.#sawCandidate = true;
    this.#extendWatch(this.contentWindow);
    if (topFrame) {
      this.#watch(doc);
    }
    if (decision.action === "click") {
      if (decision.step != null) {
        decision.root?.setAttribute("data-zen-cookie-step", String(decision.step));
      }
      this.#activate(decision.control);
      if (decision.final) {
        markClicked(decision.root);
        this.#reportHandled();
      }
      this.#schedule(decision.final ? 250 : 450);
      return;
    }
    if (decision.action === "manage") {
      try {
        this.#activate(decision.control);
      } catch {
        this.#schedule(400);
        return;
      }
      markManaged(decision.root);
      this.#schedule(400);
      return;
    }
    if (decision.rejected || decision.root?.getAttribute("data-zen-cookie-handled") === "clicked") {
      hideConsent(doc, decision.root);
      this.#reportHandled();
    }
    this.#finish();
  }

  #reportHandled() {
    if (this.#reported) {
      return;
    }
    this.#reported = true;
    try {
      this.sendAsyncMessage("ZenCookieConsent:Handled");
    } catch {
      // The actor can be destroyed while the page unloads.
    }
  }

  #activate(control) {
    if (!control) {
      return;
    }
    try {
      if (control.localName === "a") {
        control.addEventListener(
          "click",
          event => event.preventDefault(),
          { capture: true, once: true }
        );
      }
      control.click();
    } catch {
      // The control can be detached between the scan and the click.
    }
  }

  /**
   * @param {object} [options]
   * @param {boolean} [options.keepWatching] The page showed no banner. Keep a
   *   cheap observer so one that appears later is still handled.
   */
  #finish({ keepWatching = false } = {}) {
    this.#done = true;
    this.#clearTimers();
    if (
      keepWatching &&
      this.#observer &&
      !this.#destroyed &&
      this.#lateActivations < MAX_LATE_ACTIVATIONS
    ) {
      this.#late = true;
      return;
    }
    this.#stopLate();
    this.#observer?.disconnect();
    this.#observer = null;
  }

  #stopLate() {
    this.#late = false;
    this.#lateNodes = [];
    if (this.#lateTimer) {
      try {
        this.contentWindow?.clearTimeout(this.#lateTimer);
      } catch {
        // The window may already be gone.
      }
      this.#lateTimer = null;
    }
  }

  #bufferLate(records) {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType === 1 && this.#lateNodes.length < LATE_BATCH_NODES) {
          this.#lateNodes.push(node);
        }
      }
    }
    if (this.#lateTimer || !this.#lateNodes.length) {
      return;
    }
    const win = this.contentWindow;
    if (win) {
      this.#lateTimer = win.setTimeout(() => this.#processLate(), LATE_BATCH_MS);
    }
  }

  #processLate() {
    this.#lateTimer = null;
    const nodes = this.#lateNodes;
    this.#lateNodes = [];
    if (!this.#late || this.#destroyed) {
      return;
    }
    for (const node of nodes) {
      let matched = false;
      try {
        matched = node.isConnected && nodeMayContainConsent(node);
      } catch {
        matched = false;
      }
      if (matched) {
        this.#reactivate();
        return;
      }
    }
  }

  #reactivate() {
    const win = this.contentWindow;
    if (!win || this.#lateActivations >= MAX_LATE_ACTIVATIONS) {
      this.#finish();
      return;
    }
    this.#lateActivations++;
    this.#late = false;
    this.#done = false;
    this.#scans = 0;
    this.#sawCandidate = false;
    this.#extended = false;
    this.#armHardStop(win);
    this.#schedule(150);
  }
}
