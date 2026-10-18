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
export const SAMPLE_INTERVAL_MS = 5000;
// A page load can pin the CPU for a moment. Only a sustained peak counts.
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
    this.#timer = setInterval(() => this.#poll(), SAMPLE_INTERVAL_MS);
    this.#poll();
  }

  stop() {
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
    const over = cpu >= HIGH_PERCENT || ram >= HIGH_PERCENT;
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
