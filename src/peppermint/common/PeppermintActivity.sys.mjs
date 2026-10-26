/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * One answer to "is anybody using the browser right now?". Periodic work asks
 * this module instead of each feature watching focus and idle time itself.
 *
 * The browser counts as inactive when no window has focus for a short while,
 * when the user has been away from the machine for a minute, or while the
 * machine sleeps. It turns active again on the first focus or input.
 */

const IDLE_SECONDS = 60;
// Alt-tabbing away and straight back must not stop and restart everything.
const BLUR_GRACE_MS = 15000;

const SLEEP_TOPIC = "sleep_notification";
const WAKE_TOPIC = "wake_notification";
const QUIT_TOPIC = "quit-application";

class PeppermintActivityImpl {
  #observers = new Set();
  #windows = new WeakSet();
  #started = false;
  #userIdle = false;
  #asleep = false;
  #blurred = false;
  #blurTimer = null;
  #forced = null;
  #inactive = false;

  /** Whether the browser is unfocused, the user is away, or the machine sleeps. */
  get inactive() {
    return this.#inactive;
  }

  /**
   * Start watching a browser window. Safe to call for every window, and
   * safe to call more than once for the same window.
   *
   * @param {Window} win
   */
  init(win) {
    this.#start();
    if (!win || this.#windows.has(win)) {
      return;
    }
    this.#windows.add(win);
    win.addEventListener("activate", this);
    win.addEventListener("deactivate", this);
    win.addEventListener("unload", this, { once: true });
  }

  /**
   * @param {object} observer
   * @param {() => void} [observer.onInactive] - Stop periodic work
   * @param {() => void} [observer.onActive] - Resume it; catch up once
   */
  addObserver(observer) {
    this.#start();
    this.#observers.add(observer);
  }

  removeObserver(observer) {
    this.#observers.delete(observer);
  }

  /**
   * Tests pin the state with a boolean; null goes back to the real signals.
   *
   * @param {boolean|null} inactive
   */
  _force(inactive) {
    this.#forced = inactive;
    this.#evaluate();
  }

  #start() {
    if (this.#started) {
      return;
    }
    this.#started = true;
    Services.idle.addIdleObserver(this, IDLE_SECONDS);
    Services.obs.addObserver(this, SLEEP_TOPIC);
    Services.obs.addObserver(this, WAKE_TOPIC);
    Services.obs.addObserver(this, QUIT_TOPIC);
  }

  #stop() {
    this.#started = false;
    this.#clearBlurTimer();
    Services.idle.removeIdleObserver(this, IDLE_SECONDS);
    Services.obs.removeObserver(this, SLEEP_TOPIC);
    Services.obs.removeObserver(this, WAKE_TOPIC);
    Services.obs.removeObserver(this, QUIT_TOPIC);
    this.#observers.clear();
  }

  observe(subject, topic) {
    switch (topic) {
      case "idle":
        this.#userIdle = true;
        break;
      case "active":
        this.#userIdle = false;
        break;
      case SLEEP_TOPIC:
        this.#asleep = true;
        break;
      case WAKE_TOPIC:
        this.#asleep = false;
        this.#userIdle = false;
        break;
      case QUIT_TOPIC:
        this.#stop();
        return;
    }
    this.#evaluate();
  }

  handleEvent(event) {
    switch (event.type) {
      case "activate":
        this.#clearBlurTimer();
        this.#blurred = false;
        this.#evaluate();
        break;
      case "deactivate":
        this.#clearBlurTimer();
        this.#blurTimer = Cc["@mozilla.org/timer;1"].createInstance(
          Ci.nsITimer,
        );
        this.#blurTimer.initWithCallback(
          () => {
            this.#blurTimer = null;
            // Focus may only have moved to another window of the browser.
            this.#blurred = !Services.focus.activeWindow;
            this.#evaluate();
          },
          BLUR_GRACE_MS,
          Ci.nsITimer.TYPE_ONE_SHOT,
        );
        break;
      case "unload":
        event.target.defaultView?.removeEventListener("activate", this);
        event.target.defaultView?.removeEventListener("deactivate", this);
        break;
    }
  }

  #clearBlurTimer() {
    this.#blurTimer?.cancel();
    this.#blurTimer = null;
  }

  #evaluate() {
    const inactive =
      this.#forced ?? (this.#blurred || this.#userIdle || this.#asleep);
    if (inactive === this.#inactive) {
      return;
    }
    this.#inactive = inactive;
    const method = inactive ? "onInactive" : "onActive";
    for (const observer of [...this.#observers]) {
      try {
        observer[method]?.();
      } catch (error) {
        console.error(`PeppermintActivity ${method} failed`, error);
      }
    }
  }
}

export const PeppermintActivity = new PeppermintActivityImpl();
