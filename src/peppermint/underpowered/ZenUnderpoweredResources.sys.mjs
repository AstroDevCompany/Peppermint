/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { AppConstants } from "resource://gre/modules/AppConstants.sys.mjs";
import {
  clearInterval,
  setInterval,
} from "resource://gre/modules/Timer.sys.mjs";

const WORKER_URL =
  "resource:///modules/zen/underpowered/ZenUnderpoweredResources.worker.mjs";

/** CPU or RAM at or above this percent counts as very high. */
export const HIGH_PERCENT = 90;
export const SAMPLE_INTERVAL_MS = 10000;
/** While the readings cannot change anything, they are taken this rarely. */
export const SLOW_SAMPLE_INTERVAL_MS = 60000;
// A page load can pin the CPU for a moment. Only a sustained peak (about 30
// seconds) counts. Sampling less often means fewer wake-ups on battery.
export const HIGH_SAMPLES = 3;
/** Both must stay under HIGH_PERCENT this long before the load counts as over. */
export const STABLE_MS = 30000;

/**
 * Watches system-wide CPU and RAM use and reports when it turns very high and
 * when it has settled again.
 */
export class ResourceMonitor {
  #onChange;
  #high = false;
  #overSamples = 0;
  #stableSince = null;
  #timer = 0;
  #worker = null;
  #polling = false;
  #generation = 0;
  #slow = false;
  #running = false;
  /** CPU or RAM at or above this percent counts as very high. */
  threshold = HIGH_PERCENT;
  /**
   * Tests replace this with a function that returns { cpu, ram } in percent.
   *
   * @type {(() => object|Promise<object>)|null}
   */
  _sampleSource = null;

  /**
   * @param {(high: boolean) => void} onChange - Called when `high` flips
   */
  constructor(onChange) {
    this.#onChange = onChange;
  }

  get high() {
    return this.#high;
  }

  /**
   * @param {object} [options]
   * @param {boolean} [options.high] - Whether the load is already counted as
   *   very high, so a restart in the middle of it still waits for it to settle.
   */
  start({ high = false } = {}) {
    this.stop();
    this.#high = high;
    this.#running = true;
    this.#timer = setInterval(() => this.#poll(), this.#interval());
    this.#poll();
  }

  #interval() {
    return this.#slow ? SLOW_SAMPLE_INTERVAL_MS : SAMPLE_INTERVAL_MS;
  }

  /**
   * Read less often while nothing depends on fast readings, for example when
   * the user turned the mode on themselves. Counting continues, so switching
   * back loses nothing.
   *
   * @param {boolean} slow
   */
  setSlow(slow) {
    if (this.#slow === slow) {
      return;
    }
    this.#slow = slow;
    if (this.#running && this.#timer) {
      clearInterval(this.#timer);
      this.#timer = setInterval(() => this.#poll(), this.#interval());
    }
  }

  /**
   * The operating system said memory is running out. That counts as very
   * high load at once; the normal readings decide when it has settled.
   *
   */
  noteExternalPressure() {
    if (!this.#running) {
      return;
    }
    this.#stableSince = null;
    this.#overSamples = HIGH_SAMPLES;
    if (!this.#high) {
      this.#high = true;
      this.#onChange(true);
    }
  }

  stop() {
    this.#running = false;
    this.#generation++;
    this.#polling = false;
    this.#overSamples = 0;
    this.#stableSince = null;
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = 0;
    }
    this.#dropWorker();
  }

  /**
   * Take one reading into account.
   *
   * @param {{cpu: number|null, ram: number|null}} sample - Percent, or null
   *   when it could not be read, which never counts as high
   * @param {number} now - Milliseconds, on any clock that only moves forward
   */
  feed({ cpu, ram }, now) {
    const over = cpu >= this.threshold || ram >= this.threshold;
    if (over) {
      this.#stableSince = null;
      this.#overSamples++;
      if (!this.#high && this.#overSamples >= HIGH_SAMPLES) {
        this.#high = true;
        this.#onChange(true);
      }
      return;
    }
    this.#overSamples = 0;
    this.#stableSince ??= now;
    if (this.#high && now - this.#stableSince >= STABLE_MS) {
      this.#high = false;
      this.#onChange(false);
    }
  }

  async #poll() {
    if (this.#polling) {
      return;
    }
    this.#polling = true;
    const generation = this.#generation;
    let sample = { cpu: null, ram: null };
    try {
      sample = (await this.#read()) ?? sample;
    } catch (error) {
      console.error("ZenUnderpowered could not read CPU and RAM use", error);
    }
    if (generation !== this.#generation) {
      return;
    }
    this.#polling = false;
    this.feed(sample, ChromeUtils.now());
  }

  #read() {
    if (this._sampleSource) {
      return this._sampleSource();
    }
    return new Promise(resolve => {
      const empty = { cpu: null, ram: null };
      try {
        this.#worker ??= new ChromeWorker(WORKER_URL, { type: "module" });
      } catch (error) {
        console.error("ZenUnderpowered resource worker failed", error);
        resolve(empty);
        return;
      }
      const worker = this.#worker;
      worker.onmessage = event => resolve(event.data);
      worker.onerror = event => {
        event.preventDefault?.();
        this.#dropWorker();
        resolve(empty);
      };
      worker.postMessage({ platform: AppConstants.platform });
    });
  }

  #dropWorker() {
    this.#worker?.terminate();
    this.#worker = null;
  }
}
