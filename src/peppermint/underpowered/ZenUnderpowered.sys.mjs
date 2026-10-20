/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { isUnloadSafe } from "moz-src:///peppermint/common/PeppermintTabs.sys.mjs";
import { ResourceMonitor } from "moz-src:///peppermint/underpowered/ZenUnderpoweredResources.sys.mjs";

const PREF_ENABLED = "zen.underpowered.enabled";
const PREF_SAVED = "zen.underpowered.saved-prefs";
const PREF_AUTO = "zen.underpowered.auto-on-battery";
const PREF_AUTO_RESOURCES = "zen.underpowered.auto-on-resources";
const PREF_THRESHOLD = "zen.underpowered.battery-threshold";
const PREF_AUTO_ENABLED = "zen.underpowered.auto-enabled";
const PREF_WHEN_UNPLUGGED = "zen.underpowered.auto-when-unplugged";
const PREF_RESOURCE_THRESHOLD = "zen.underpowered.resource-threshold";
const PREF_GRACE = "zen.underpowered.freeze-grace-seconds";
const PREF_NEVER_FREEZE = "zen.underpowered.never-freeze";
const ROOT_ATTRIBUTE = "zen-underpowered";
const BUTTON_ID = "zen-underpowered-button";
const TOAST_ID = "zen-underpowered-enabled-toast";
const TOAST_OFF_ID = "zen-underpowered-disabled-toast";
const TOAST_TIMEOUT_MS = 1800;
// Lets tab switches and Glance settle before the tab left behind is frozen.
const FREEZE_DELAY_MS = 250;
// A tab nobody can freeze yet is looked at again at least this often.
const SWEEP_MS = 60 * 1000;
// Loading frozen tabs again in small groups keeps the machine responsive
// right after the mode ends, when it was struggling a moment ago.
const THAW_BATCH = 3;
const THAW_BATCH_MS = 400;
const MEMORY_PRESSURE_TOPIC = "memory-pressure";

// Every one of these is read live, so none of them waits for a restart.
const LIMITS = {
  "dom.ipc.processCount": 1,
  "dom.ipc.processCount.webIsolated": 1,
  "dom.ipc.processPrelaunch.enabled": false,
  "dom.min_background_timeout_value": 10000,
  "image.animation_mode": "none",
  "network.prefetch-next": false,
  "network.dns.disablePrefetch": true,
  "network.http.max-connections": 128,
  "browser.cache.memory.capacity": 16384,
  "layout.frame_rate": 30,
  "ui.prefersReducedMotion": 1,
  "browser.sessionstore.interval": 120000,
};

/**
 * @param {string} name
 * @returns {boolean|number|string|null} The pref's user value, or null when
 *   it is on its default.
 */
function readUserValue(name) {
  if (!Services.prefs.prefHasUserValue(name)) {
    return null;
  }
  switch (Services.prefs.getPrefType(name)) {
    case Ci.nsIPrefBranch.PREF_BOOL:
      return Services.prefs.getBoolPref(name);
    case Ci.nsIPrefBranch.PREF_INT:
      return Services.prefs.getIntPref(name);
    case Ci.nsIPrefBranch.PREF_STRING:
      return Services.prefs.getStringPref(name);
  }
  return null;
}

function writeValue(name, value) {
  switch (typeof value) {
    case "boolean":
      Services.prefs.setBoolPref(name, value);
      break;
    case "number":
      Services.prefs.setIntPref(name, value);
      break;
    default:
      Services.prefs.setStringPref(name, value);
  }
}

const LIMITS_NAMES = new Set(Object.keys(LIMITS));

/**
 * App-wide Underpowered mode. While it is on, every window keeps only what is
 * on screen loaded, and a set of resource prefs is tightened; turning it off
 * puts both back.
 */
class ZenUnderpoweredImpl {
  #initialized = false;
  #enabled = false;
  /** @type {Map<Window, object>} */
  #windows = new Map();
  /** Tabs this mode unloaded, the only ones it loads again. */
  #frozen = new WeakSet();
  #freezing = new WeakSet();
  #battery = null;
  #batteryHost = null;
  #onLevel = null;
  #onCharging = null;
  #batteryToken = 0;
  #writingAuto = false;
  /** Whether the battery is low and unplugged. */
  #batteryLow = false;
  /** Whether CPU or RAM use is very high, and has not settled yet. */
  #resourcesHigh = false;
  #resources = new ResourceMonitor(high => {
    this.#resourcesHigh = high;
    this.#evaluateAuto();
  });
  /** The user turned off an automatic session that is still warranted. */
  #dismissed = false;
  /** Tuned prefs somebody else changed while the mode was on. */
  #userChanged = new Set();
  #writingLimits = false;
  /** Sites (lower case host names) whose tabs are never frozen. */
  #neverFreeze = [];
  /**
   * Tests replace this with a function that returns a battery manager.
   *
   * @type {(() => object|Promise<object>)|null}
   */
  _batterySource = null;

  init() {
    if (this.#initialized) {
      return;
    }
    this.#initialized = true;
    Services.prefs.addObserver(PREF_ENABLED, this);
    Services.prefs.addObserver(PREF_AUTO, this);
    Services.prefs.addObserver(PREF_THRESHOLD, this);
    Services.prefs.addObserver(PREF_AUTO_RESOURCES, this);
    Services.prefs.addObserver(PREF_WHEN_UNPLUGGED, this);
    Services.prefs.addObserver(PREF_RESOURCE_THRESHOLD, this);
    Services.prefs.addObserver(PREF_GRACE, this);
    Services.prefs.addObserver(PREF_NEVER_FREEZE, this);
    Services.obs.addObserver(this, "browser-delayed-startup-finished");
    Services.obs.addObserver(this, MEMORY_PRESSURE_TOPIC);
    this.#readNeverFreeze();
    this.#resources.threshold = this.#readThreshold();
    this.#update(true);
    // A session left on by the previous run is kept until every source has
    // looked at the machine again, so a restart does not drop it early.
    this.#batteryLow = this.#resourcesHigh =
      Services.prefs.getBoolPref(PREF_ENABLED, false) &&
      Services.prefs.getBoolPref(PREF_AUTO_ENABLED, false);
    this.#syncBattery();
    this.#syncResources();
  }

  observe(subject, topic, data) {
    if (topic === "browser-delayed-startup-finished") {
      if (this.#enabled) {
        this.#attach(subject);
      } else {
        this.#syncChrome(subject);
      }
      return;
    }
    if (topic === MEMORY_PRESSURE_TOPIC) {
      // Only the operating system running low counts. The heap-minimize
      // request sent when the mode turns on shares this topic.
      if (data === "low-memory" || data === "low-memory-ongoing") {
        this.#resources.noteExternalPressure();
      }
      return;
    }
    if (topic === "nsPref:changed" && LIMITS_NAMES.has(data)) {
      this.#noteLimitChange(data);
      return;
    }
    if (data === PREF_AUTO || data === PREF_WHEN_UNPLUGGED) {
      this.#syncBattery();
      return;
    }
    if (data === PREF_RESOURCE_THRESHOLD) {
      this.#resources.threshold = this.#readThreshold();
      return;
    }
    if (data === PREF_NEVER_FREEZE) {
      this.#readNeverFreeze();
      this.#refreezeAll();
      return;
    }
    if (data === PREF_GRACE) {
      this.#refreezeAll();
      return;
    }
    if (data === PREF_THRESHOLD) {
      if (this.#battery) {
        this.#applyBattery(this.#battery);
      }
      return;
    }
    if (data === PREF_AUTO_RESOURCES) {
      this.#syncResources();
      return;
    }
    if (data === PREF_ENABLED && !this.#writingAuto) {
      this.#noteManualToggle();
    }
    this.#update();
  }

  /**
   * Re-read the battery. Tests await this after installing `_batterySource`.
   *
   * @returns {Promise<void>}
   */
  syncBatteryForTests() {
    return this.#syncBattery();
  }

  /**
   * The resource monitor, so tests can feed it readings.
   *
   * @returns {ResourceMonitor}
   */
  get resourceMonitorForTests() {
    return this.#resources;
  }

  /**
   * Start or stop the resource monitor to match its pref. Tests call this
   * after installing a sample source.
   */
  syncResourcesForTests() {
    this.#syncResources();
  }

  /**
   * @param {Element} button - The Underpowered toolbar button
   */
  syncButton(button) {
    const enabled = Services.prefs.getBoolPref(PREF_ENABLED, false);
    if (enabled) {
      button.setAttribute("checked", "true");
    } else {
      button.removeAttribute("checked");
    }
    button.setAttribute("aria-pressed", String(enabled));
  }

  #update(startup = false) {
    const enabled = Services.prefs.getBoolPref(PREF_ENABLED, false);
    if (!startup && enabled === this.#enabled) {
      return;
    }
    this.#enabled = enabled;
    if (enabled) {
      this.#applyLimits();
      this.#watchLimits(true);
      if (!startup) {
        Services.obs.notifyObservers(null, MEMORY_PRESSURE_TOPIC, "heap-minimize");
      }
    } else {
      this.#watchLimits(false);
      // Also covers a snapshot left over from a session that ended mid-mode.
      this.#restoreLimits();
    }
    this.#syncPolling();
    for (const win of this.#browserWindows()) {
      if (enabled) {
        this.#attach(win);
      } else {
        this.#detach(win);
      }
    }
    if (!enabled) {
      this.#frozen = new WeakSet();
    }
    if (!startup) {
      this.#announce(enabled);
    }
  }

  /**
   * Tells the user the mode changed, and why when Peppermint did it itself,
   * since the mode also changes pages (frozen tabs, no GIFs, less motion).
   *
   * @param {boolean} enabled
   */
  #announce(enabled) {
    let descriptionId = "zen-underpowered-enabled-toast-description";
    if (!enabled) {
      descriptionId = this.#writingAuto
        ? "zen-underpowered-auto-disabled-toast-description"
        : "zen-underpowered-disabled-toast-description";
    } else if (this.#writingAuto) {
      descriptionId = this.#batteryLow
        ? "zen-underpowered-battery-toast-description"
        : "zen-underpowered-resources-toast-description";
    }
    const win = Services.wm.getMostRecentBrowserWindow();
    win?.gZenUIManager?.showToast(
      enabled ? TOAST_ID : TOAST_OFF_ID,
      {
        descriptionId,
        timeout: TOAST_TIMEOUT_MS,
        frosted: true,
      }
    );
  }

  *#browserWindows() {
    for (const win of Services.wm.getEnumerator("navigator:browser")) {
      if (!win.closed && win.gBrowserInit?.delayedStartupFinished) {
        yield win;
      }
    }
  }

  // Automatic sessions

  #noteManualToggle() {
    const enabled = Services.prefs.getBoolPref(PREF_ENABLED, false);
    if (enabled || !Services.prefs.getBoolPref(PREF_AUTO_ENABLED, false)) {
      return;
    }
    // The user turned off a session we started. Stay off until the cause is
    // gone, so the same low battery or load does not turn it straight back on.
    this.#dismissed = this.#autoWanted();
    this.#writeOwned(false);
  }

  #writeOwned(owned) {
    this.#writingAuto = true;
    try {
      Services.prefs.setBoolPref(PREF_AUTO_ENABLED, owned);
    } finally {
      this.#writingAuto = false;
    }
  }

  #setAuto(enabled) {
    this.#writingAuto = true;
    try {
      Services.prefs.setBoolPref(PREF_AUTO_ENABLED, enabled);
      Services.prefs.setBoolPref(PREF_ENABLED, enabled);
    } finally {
      this.#writingAuto = false;
    }
  }

  #autoWanted() {
    return this.#batteryLow || this.#resourcesHigh;
  }

  /**
   * Turn the mode on when any source calls for it, and off again, but only
   * if this code turned it on, once none does.
   */
  #evaluateAuto() {
    const enabled = Services.prefs.getBoolPref(PREF_ENABLED, false);
    if (this.#autoWanted()) {
      if (!enabled && !this.#dismissed) {
        this.#setAuto(true);
      }
      return;
    }
    this.#dismissed = false;
    if (Services.prefs.getBoolPref(PREF_AUTO_ENABLED, false)) {
      this.#setAuto(false);
    }
  }

  /**
   * A source was switched off. A session it started stays on as if the user
   * had turned it on, unless another source still calls for it.
   */
  #releaseOwnership() {
    if (this.#autoWanted()) {
      return;
    }
    this.#dismissed = false;
    if (Services.prefs.getBoolPref(PREF_AUTO_ENABLED, false)) {
      this.#writeOwned(false);
    }
  }

  // Resources

  #readThreshold() {
    const value = Services.prefs.getIntPref(PREF_RESOURCE_THRESHOLD, 90);
    return Math.min(99, Math.max(50, value));
  }

  /**
   * An automatic session needs the fast readings to notice when the load has
   * settled. A session the user started needs none, so it is read slowly.
   */
  #syncPolling() {
    this.#resources.setSlow(
      this.#enabled && !Services.prefs.getBoolPref(PREF_AUTO_ENABLED, false)
    );
  }

  #syncResources() {
    this.#resources.stop();
    if (!Services.prefs.getBoolPref(PREF_AUTO_RESOURCES, false)) {
      this.#resourcesHigh = false;
      this.#releaseOwnership();
      return;
    }
    this.#resources.start({ high: this.#resourcesHigh });
  }

  // Battery

  #batteryWindow() {
    if (this._batterySource) {
      return null;
    }
    try {
      const hidden = Services.appShell.hiddenDOMWindow;
      if (hidden && typeof hidden.navigator?.getBattery === "function") {
        this.#batteryHost = hidden;
        return hidden;
      }
    } catch {
      // The hidden window is not available yet.
    }
    for (const win of Services.wm.getEnumerator("navigator:browser")) {
      if (win.closed || typeof win.navigator?.getBattery !== "function") {
        continue;
      }
      if (!win.__zenUnderpoweredBatteryUnload) {
        win.__zenUnderpoweredBatteryUnload = true;
        win.addEventListener(
          "unload",
          () => {
            if (this.#batteryHost === win) {
              this.#batteryHost = null;
              this.#syncBattery();
            }
          },
          { once: true }
        );
      }
      this.#batteryHost = win;
      return win;
    }
    this.#batteryHost = null;
    return null;
  }

  #dropBattery() {
    if (this.#battery) {
      this.#battery.removeEventListener("levelchange", this.#onLevel);
      this.#battery.removeEventListener("chargingchange", this.#onCharging);
    }
    this.#battery = null;
    this.#onLevel = null;
    this.#onCharging = null;
  }

  async #syncBattery() {
    const token = ++this.#batteryToken;
    this.#dropBattery();
    if (!Services.prefs.getBoolPref(PREF_AUTO, false)) {
      this.#batteryLow = false;
      this.#releaseOwnership();
      return;
    }
    let battery = null;
    try {
      if (this._batterySource) {
        battery = await this._batterySource();
      } else {
        const win = this.#batteryWindow();
        if (win) {
          battery = await win.navigator.getBattery();
        }
      }
    } catch (error) {
      console.error("ZenUnderpowered could not read the battery", error);
    }
    if (token !== this.#batteryToken) {
      return;
    }
    if (!battery) {
      this.#batteryLow = false;
      this.#evaluateAuto();
      return;
    }
    this.#onLevel = () => this.#applyBattery(battery);
    this.#onCharging = () => this.#applyBattery(battery);
    battery.addEventListener("levelchange", this.#onLevel);
    battery.addEventListener("chargingchange", this.#onCharging);
    this.#battery = battery;
    this.#applyBattery(battery);
  }

  #applyBattery(battery) {
    const threshold = Services.prefs.getIntPref(PREF_THRESHOLD, 30) / 100;
    const unpluggedIsEnough = Services.prefs.getBoolPref(
      PREF_WHEN_UNPLUGGED,
      false
    );
    this.#batteryLow =
      !battery.charging && (unpluggedIsEnough || battery.level < threshold);
    this.#evaluateAuto();
  }

  // Resource limits

  #readSnapshot() {
    try {
      return JSON.parse(Services.prefs.getStringPref(PREF_SAVED, "{}")) ?? {};
    } catch (error) {
      console.error("ZenUnderpowered: unreadable saved prefs", error);
      return {};
    }
  }

  #applyLimits() {
    // Recorded before anything changes, and never overwritten while the mode
    // is on, so a restart cannot mistake the lowered values for the originals.
    const saved = this.#readSnapshot();
    let added = false;
    for (const name of Object.keys(LIMITS)) {
      if (!(name in saved)) {
        saved[name] = readUserValue(name);
        added = true;
      }
    }
    if (added) {
      Services.prefs.setStringPref(PREF_SAVED, JSON.stringify(saved));
    }
    this.#userChanged.clear();
    this.#writingLimits = true;
    try {
      for (const [name, value] of Object.entries(LIMITS)) {
        try {
          writeValue(name, value);
        } catch (error) {
          console.error(`ZenUnderpowered: could not set ${name}`, error);
        }
      }
    } finally {
      this.#writingLimits = false;
    }
  }

  #watchLimits(on) {
    for (const name of LIMITS_NAMES) {
      if (on) {
        Services.prefs.addObserver(name, this);
      } else {
        Services.prefs.removeObserver(name, this);
      }
    }
  }

  /**
   * One of the tuned prefs changed while the mode is on. If somebody else did
   * it on purpose, that value is theirs and is kept when the mode ends.
   *
   * @param {string} name
   */
  #noteLimitChange(name) {
    if (this.#writingLimits || !this.#enabled) {
      return;
    }
    this.#userChanged.add(name);
  }

  #restoreLimits() {
    if (!Services.prefs.prefHasUserValue(PREF_SAVED)) {
      return;
    }
    for (const [name, value] of Object.entries(this.#readSnapshot())) {
      if (this.#userChanged.has(name)) {
        continue;
      }
      try {
        if (value === null) {
          Services.prefs.clearUserPref(name);
        } else {
          writeValue(name, value);
        }
      } catch (error) {
        console.error(`ZenUnderpowered: could not restore ${name}`, error);
      }
    }
    this.#userChanged.clear();
    Services.prefs.clearUserPref(PREF_SAVED);
  }

  // Windows

  #syncChrome(win) {
    const enabled = Services.prefs.getBoolPref(PREF_ENABLED, false);
    win.document.documentElement.toggleAttribute(ROOT_ATTRIBUTE, enabled);
    const button = win.document.getElementById(BUTTON_ID);
    if (button) {
      this.syncButton(button);
    }
  }

  #attach(win) {
    this.#syncChrome(win);
    if (!this.#windows.has(win)) {
      const { STATE_STOP, STATE_IS_WINDOW } = Ci.nsIWebProgressListener;
      const state = {
        timer: 0,
        onTabSelect: () => this.#scheduleFreeze(win),
        onUnload: () => {
          win.clearTimeout(state.timer);
          this.#windows.delete(win);
        },
        progressListener: {
          onStateChange: (browser, webProgress, request, flags) => {
            if (
              webProgress?.isTopLevel &&
              flags & STATE_STOP &&
              flags & STATE_IS_WINDOW
            ) {
              this.#scheduleFreeze(win);
            }
          },
        },
      };
      this.#windows.set(win, state);
      win.gBrowser.addTabsProgressListener(state.progressListener);
      win.gBrowser.tabContainer.addEventListener(
        "TabSelect",
        state.onTabSelect
      );
      win.addEventListener("unload", state.onUnload, { once: true });
    }
    this.#scheduleFreeze(win);
  }

  #detach(win) {
    this.#syncChrome(win);
    const state = this.#windows.get(win);
    if (state) {
      this.#windows.delete(win);
      win.clearTimeout(state.timer);
      win.gBrowser.removeTabsProgressListener(state.progressListener);
      win.gBrowser.tabContainer.removeEventListener(
        "TabSelect",
        state.onTabSelect
      );
      win.removeEventListener("unload", state.onUnload);
    }
    this.#thaw(win);
  }

  // Freezing

  #readNeverFreeze() {
    const raw = Services.prefs.getStringPref(PREF_NEVER_FREEZE, "");
    this.#neverFreeze = raw
      .split(/[\s,;]+/)
      .map(entry => entry.trim().toLowerCase().replace(/^\*?\./, ""))
      .filter(Boolean);
  }

  /**
   * @param {string} host
   * @returns {boolean} Whether the host is on the never-freeze list
   */
  #isNeverFrozen(host) {
    const name = host.toLowerCase();
    return this.#neverFreeze.some(
      entry => name === entry || name.endsWith("." + entry)
    );
  }

  #refreezeAll() {
    if (!this.#enabled) {
      return;
    }
    for (const win of this.#windows.keys()) {
      this.#scheduleFreeze(win);
    }
  }

  #scheduleFreeze(win, delay = FREEZE_DELAY_MS) {
    const state = this.#windows.get(win);
    if (!state) {
      return;
    }
    win.clearTimeout(state.timer);
    state.timer = win.setTimeout(() => {
      state.timer = 0;
      this.#freezeWindow(win);
    }, delay);
  }

  #freezeWindow(win) {
    if (win.closed || !this.#windows.has(win)) {
      return;
    }
    const selected = win.gBrowser.selectedTab;
    // The next time this window needs a look: when the first tab that is
    // still inside its grace period runs out, or after a sweep interval while
    // other live tabs could change state (stop playing sound, finish loading).
    let next = Infinity;
    let live = 0;
    for (const tab of win.gBrowser.tabs) {
      if (tab !== selected && tab.linkedPanel && !tab.hasAttribute("pending")) {
        live++;
      }
      if (!this.#canFreeze(tab, selected)) {
        continue;
      }
      const wait = this.#graceRemaining(tab);
      if (wait > 0) {
        next = Math.min(next, wait);
        continue;
      }
      this.#freezeTab(win, tab);
    }
    if (live) {
      this.#scheduleFreeze(win, Math.min(next + 50, SWEEP_MS));
    }
  }

  /**
   * @param {MozTabbrowserTab} tab
   * @returns {number} Milliseconds until the tab has been in the background
   *   long enough to freeze; 0 when it already has
   */
  #graceRemaining(tab) {
    const grace = Math.max(0, Services.prefs.getIntPref(PREF_GRACE, 20)) * 1000;
    const age = Date.now() - tab.lastAccessed;
    // A tab that is being shown has no age yet.
    return Number.isFinite(age) ? Math.max(0, grace - age) : grace;
  }

  /**
   * @param {MozTabbrowserTab} tab
   * @param {MozTabbrowserTab} selected - The window's selected tab
   * @returns {boolean} Whether the tab is live, off screen, silent, and safe to unload
   */
  #canFreeze(tab, selected) {
    if (!isUnloadSafe(tab, selected)) {
      return false;
    }
    // Pinned tabs may freeze (they reload on click), but a tab that is making
    // sound, sharing a camera, microphone or screen, or backing a glance
    // overlay must keep running.
    if (
      tab.soundPlaying ||
      tab.hasAttribute("soundplaying") ||
      tab.hasAttribute("sharing") ||
      tab.hasAttribute("zen-glance-tab") ||
      tab.hasAttribute("glance-id")
    ) {
      return false;
    }
    if (this.#neverFreeze.length) {
      try {
        if (this.#isNeverFrozen(tab.linkedBrowser.currentURI.host)) {
          return false;
        }
      } catch {
        // Pages without a host (about:, file:) have no entry to match.
      }
    }
    return true;
  }

  async #freezeTab(win, tab) {
    if (this.#freezing.has(tab)) {
      return;
    }
    this.#freezing.add(tab);
    try {
      // Session state has to be current before the browser goes away.
      await win.gBrowser.prepareDiscardBrowser(tab);
      if (
        this.#windows.has(win) &&
        this.#canFreeze(tab, win.gBrowser.selectedTab) &&
        this.#graceRemaining(tab) === 0 &&
        // Not forced: a beforeunload handler or open dialog keeps the tab.
        win.gBrowser.discardBrowser(tab)
      ) {
        this.#frozen.add(tab);
      }
    } catch (error) {
      console.error("ZenUnderpowered: could not freeze tab", error);
    } finally {
      this.#freezing.delete(tab);
    }
  }

  /**
   * Loads the tabs this mode froze again, a few at a time.
   *
   * @param {Window} win
   */
  #thaw(win) {
    const tabs = win.gBrowser.tabs.filter(
      tab =>
        this.#frozen.has(tab) && tab.hasAttribute("pending") && !tab.closing
    );
    const next = () => {
      if (win.closed || !win.gBrowser) {
        return;
      }
      // A tab can be restored by the user or closed while the rest wait.
      const batch = tabs
        .splice(0, THAW_BATCH)
        .filter(tab => tab.hasAttribute("pending") && !tab.closing);
      if (batch.length) {
        this.#restoreTabs(win, batch);
      }
      if (tabs.length) {
        win.setTimeout(next, THAW_BATCH_MS);
      }
    };
    if (tabs.length) {
      next();
    }
  }

  #restoreTabs(win, tabs) {
    const { gBrowser } = win;
    for (const tab of tabs) {
      gBrowser.insertBrowser(tab);
    }
    // SessionStore restores the content of every tab named in this event. Not
    // bubbling, so it reaches SessionStore on the tab container and nothing
    // that tracks split views on the window.
    gBrowser.tabContainer.dispatchEvent(
      new win.CustomEvent("TabSplitViewActivate", { detail: { tabs } })
    );
  }

  /**
   * @returns {number} Background tabs this mode is holding unloaded right now
   */
  get frozenCount() {
    let count = 0;
    for (const win of this.#browserWindows()) {
      for (const tab of win.gBrowser.tabs) {
        if (this.#frozen.has(tab) && tab.hasAttribute("pending")) {
          count++;
        }
      }
    }
    return count;
  }
}

export const ZenUnderpowered = new ZenUnderpoweredImpl();
