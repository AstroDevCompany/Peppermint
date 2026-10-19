/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Peppermint Janitor: frees disk space on launch by clearing temporary files,
 * usage traces, update leftovers and app caches that have not been used for
 * 72 hours, and optionally the recycle bin. Nothing runs until the user opts
 * in. The filesystem rules live in PeppermintJanitorCleaner, the list of
 * places in PeppermintJanitorTargets.
 */

import {
  JanitorCleaner,
  UnitStatus,
} from "moz-src:///peppermint/janitor/PeppermintJanitorCleaner.sys.mjs";
import {
  isRunDue,
  lastRunAt,
  recordRun,
} from "moz-src:///peppermint/janitor/PeppermintJanitorHistory.sys.mjs";
import {
  GROUPS,
  getEnvironment,
  getProtectedFolders,
  getProtectedTrees,
  normalizePath,
  resolveUnits,
} from "moz-src:///peppermint/janitor/PeppermintJanitorTargets.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  DownloadUtils: "resource://gre/modules/DownloadUtils.sys.mjs",
  clearTimeout: "resource://gre/modules/Timer.sys.mjs",
  setInterval: "resource://gre/modules/Timer.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
});

export const PREFS = Object.freeze({
  enabled: "peppermint.janitor.enabled",
  prompted: "peppermint.janitor.prompted",
  notifications: "peppermint.janitor.notifications",
  schedule: "peppermint.janitor.schedule",
  dryRun: "peppermint.janitor.dry-run",
  groups: {
    temp: "peppermint.janitor.clean-temp",
    traces: "peppermint.janitor.clean-traces",
    updates: "peppermint.janitor.clean-updates",
    caches: "peppermint.janitor.clean-caches",
    trash: "peppermint.janitor.clean-recycle-bin",
  },
});

const PREF_WELCOME_SEEN = "zen.welcome-screen.seen";
const CHECK_ICON = "chrome://global/skin/icons/check-filled.svg";
const WORKER_URL =
  "resource:///modules/zen/janitor/PeppermintJanitorRecycleBin.worker.mjs";

// Stay out of the way of session restore and the first page loads.
const START_DELAY_MS = 20 * 1000;
// With a daily or weekly schedule the browser may stay open for days, so it
// looks once an hour whether a run has become due.
const DUE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
// Groups that freed less than this stay silent.
const MIN_TOAST_BYTES = 1024 * 1024;
const TOAST_TIMEOUT_MS = 3500;
// Toasts of one run appear this far apart, so they cascade instead of popping
// in as one block.
const TOAST_STAGGER_MS = 150;
const WORKER_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * @param {number} bytes
 * @returns {string} A localized size such as "1.4 GB".
 */
export function formatSize(bytes) {
  const [size, unit] = lazy.DownloadUtils.convertByteUnits(bytes);
  return `${size} ${unit}`;
}

function sleep(ms) {
  return new Promise(resolve => lazy.setTimeout(resolve, ms));
}

/**
 * @typedef {object} GroupSummary
 * @property {string} group - One of GROUPS.
 * @property {number} bytes - Bytes freed (or that would be, in a dry run).
 * @property {number} files - Files removed (or that would be).
 * @property {number} units - Locations that were cleaned.
 */

/**
 * @typedef {object} RunSummary
 * @property {GroupSummary[]} groups - Only groups that freed something.
 * @property {number} totalBytes - Bytes freed over all groups.
 * @property {boolean} dryRun - Nothing was deleted.
 * @property {number} errors - Locations that could not be cleaned because
 *   of an error (files in use or protected on purpose are not errors).
 */

class PeppermintJanitorImpl {
  #started = false;
  /** @type {Promise<RunSummary>|null} */
  #running = null;

  /**
   * Called for every browser window; only the first one does anything.
   *
   * @param {Window} window
   */
  init(window) {
    if (this.#started) {
      return;
    }
    this.#started = true;
    // Test runs must never clean the machine they run on, nor ask to.
    if (Cu.isInAutomation) {
      return;
    }
    this.#whenWindowReady(window, () => this.#schedule());
  }

  /** @returns {boolean} Whether the opt-in dialog still has to be shown. */
  shouldPrompt() {
    return (
      !Services.prefs.getBoolPref(PREFS.enabled, false) &&
      !Services.prefs.getBoolPref(PREFS.prompted, false)
    );
  }

  /** @returns {boolean} Whether a run is in progress. */
  get running() {
    return !!this.#running;
  }

  #whenWindowReady(window, callback) {
    if (window.gBrowserInit?.delayedStartupFinished) {
      callback();
      return;
    }
    const observer = {
      observe(subject, topic) {
        if (subject !== window) {
          return;
        }
        Services.obs.removeObserver(observer, topic);
        callback();
      },
    };
    Services.obs.addObserver(observer, "browser-delayed-startup-finished");
  }

  #schedule() {
    if (Services.prefs.getBoolPref(PREFS.enabled, false)) {
      const check = atStart =>
        ChromeUtils.idleDispatch(() => {
          this.runIfDue({ atStart }).catch(e =>
            console.error("Janitor: run failed", e)
          );
        });
      lazy.setTimeout(() => check(true), START_DELAY_MS);
      lazy.setInterval(() => check(false), DUE_CHECK_INTERVAL_MS);
    } else if (this.shouldPrompt()) {
      this.#promptWhenWelcomed();
    }
  }

  /** The welcome screen goes first on a new profile. */
  #promptWhenWelcomed() {
    const show = () =>
      lazy.setTimeout(
        () =>
          this.#prompt().catch(e => console.error("Janitor: prompt failed", e)),
        START_DELAY_MS / 2
      );
    if (Services.prefs.getBoolPref(PREF_WELCOME_SEEN, true)) {
      show();
      return;
    }
    const observer = {
      observe() {
        if (Services.prefs.getBoolPref(PREF_WELCOME_SEEN, true)) {
          Services.prefs.removeObserver(PREF_WELCOME_SEEN, observer);
          show();
        }
      },
    };
    Services.prefs.addObserver(PREF_WELCOME_SEEN, observer);
  }

  async #prompt() {
    if (!this.shouldPrompt()) {
      return;
    }
    const win = Services.wm.getMostRecentBrowserWindow();
    if (!win?.document.l10n) {
      return;
    }
    const [title, message, enable, notNow] =
      await win.document.l10n.formatValues(
        [
          "peppermint-janitor-prompt-title",
          "peppermint-janitor-prompt-message",
          "peppermint-janitor-prompt-enable",
          "peppermint-janitor-prompt-not-now",
        ].map(id => ({ id }))
      );
    // Asked once, whatever the answer.
    Services.prefs.setBoolPref(PREFS.prompted, true);

    const flags =
      Services.prompt.BUTTON_POS_0_DEFAULT |
      (Services.prompt.BUTTON_TITLE_IS_STRING * Services.prompt.BUTTON_POS_0) |
      (Services.prompt.BUTTON_TITLE_IS_STRING * Services.prompt.BUTTON_POS_1);
    const result = await Services.prompt.asyncConfirmEx(
      win.browsingContext,
      Services.prompt.MODAL_TYPE_INTERNAL_WINDOW,
      title,
      message,
      flags,
      enable,
      notNow,
      null,
      null,
      false,
      { useTitle: true }
    );
    if (result.get("buttonNumClicked") === 0) {
      Services.prefs.setBoolPref(PREFS.enabled, true);
      await this.run();
    }
  }

  /**
   * Runs the Janitor if the schedule says it is time. "Every launch" cleans
   * once at start; "daily" and "weekly" clean when that long has passed since
   * the last run, checked at start and then every hour.
   *
   * @param {object} [options]
   * @param {boolean} [options.atStart] - The browser just started
   * @param {object} [options.run] - Options passed on to run() (tests)
   * @returns {Promise<RunSummary|null>} The run, or null when none was due
   */
  async runIfDue({ atStart = false, run = {} } = {}) {
    if (!Services.prefs.getBoolPref(PREFS.enabled, false)) {
      return null;
    }
    const schedule = Services.prefs.getStringPref(PREFS.schedule, "startup");
    if (schedule === "startup") {
      return atStart ? this.run(run) : null;
    }
    return isRunDue(schedule, await lastRunAt()) ? this.run(run) : null;
  }

  /**
   * Cleans now. Only one run happens at a time; callers during a run get the
   * same result.
   *
   * @param {object} [options]
   * @param {boolean} [options.manual] - Started by the user ("Clean now"):
   *   toasts are shown even when notifications are off, and an empty run says
   *   so.
   * @param {boolean} [options.dryRun] - Overrides the dry-run pref.
   * @param {string[]} [options.groups] - Overrides the group prefs.
   * @param {boolean} [options.notify] - Overrides the notification pref.
   * @param {object} [options.environment] - Tests only: replaces the real
   *   machine (see PeppermintJanitorTargets.getEnvironment).
   * @param {string[]} [options.protectedTrees] - Tests only.
   * @param {string[]} [options.protectedFolders] - Tests only.
   * @param {number} [options.now] - Tests only.
   * @returns {Promise<RunSummary>}
   */
  run(options = {}) {
    if (!this.#running) {
      this.#running = this.#run(options).finally(() => {
        this.#running = null;
      });
    }
    return this.#running;
  }

  #enabledGroups() {
    return GROUPS.filter(group =>
      Services.prefs.getBoolPref(PREFS.groups[group], false)
    );
  }

  async #run(options) {
    const dryRun =
      options.dryRun ?? Services.prefs.getBoolPref(PREFS.dryRun, false);
    const groups = options.groups ?? this.#enabledGroups();
    const env = options.environment ?? getEnvironment();
    const summary = { groups: [], totalBytes: 0, dryRun, errors: 0 };

    if (env.home && env.tmp) {
      const home = normalizePath(env.home) ?? env.home;
      const cleaner = new JanitorCleaner({
        home,
        protectedTrees: options.protectedTrees ?? getProtectedTrees(),
        protectedInside:
          options.protectedFolders ?? getProtectedFolders(env.home),
        dryRun,
        ...(options.now ? { now: options.now } : {}),
      });
      const units = resolveUnits(env, groups);
      const results = await cleaner.run(units);
      if (dryRun) {
        for (const { unit, status, bytes } of results) {
          console.warn(
            `Janitor dry run: ${unit.group} ${status} ${bytes} bytes ${unit.path}`
          );
        }
      }
      this.#collect(summary, results);
      if (env.os === "WINNT" && groups.includes("trash")) {
        const bin = await this.#emptyWindowsRecycleBin(dryRun);
        this.#add(summary, "trash", bin.bytes, bin.items, bin.bytes ? 1 : 0);
        if (!bin.ok) {
          summary.errors++;
        }
      }
    }

    summary.groups.sort(
      (a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group)
    );
    summary.totalBytes = summary.groups.reduce((sum, g) => sum + g.bytes, 0);
    if (dryRun) {
      console.warn(
        `Janitor dry run: ${summary.totalBytes} bytes in ${summary.groups.length} group(s)`
      );
    }

    if (!dryRun) {
      await recordRun(summary, { manual: !!options.manual });
    }

    const notify =
      options.notify ??
      (options.manual || Services.prefs.getBoolPref(PREFS.notifications, true));
    if (notify && !dryRun) {
      await this.#notify(summary, !!options.manual);
    }
    return summary;
  }

  #collect(summary, results) {
    for (const { unit, status, bytes, files } of results) {
      if (status === UnitStatus.CLEANED || status === UnitStatus.DRY_RUN) {
        this.#add(summary, unit.group, bytes, files, 1);
      } else if (status === UnitStatus.ERROR) {
        summary.errors++;
      }
    }
  }

  #add(summary, group, bytes, files, units) {
    if (!bytes && !files) {
      return;
    }
    let entry = summary.groups.find(g => g.group === group);
    if (!entry) {
      entry = { group, bytes: 0, files: 0, units: 0 };
      summary.groups.push(entry);
    }
    entry.bytes += bytes;
    entry.files += files;
    entry.units += units;
  }

  /**
   * Windows keeps the recycle bin in the shell, not in plain files.
   *
   * @param {boolean} dryRun
   * @returns {Promise<{ok: boolean, bytes: number, items: number}>}
   */
  #emptyWindowsRecycleBin(dryRun) {
    return new Promise(resolve => {
      let worker;
      let timer;
      const finish = reply => {
        lazy.clearTimeout(timer);
        try {
          worker?.terminate();
        } catch (e) {
          // Already gone.
        }
        resolve(reply);
      };
      try {
        worker = new ChromeWorker(WORKER_URL, { type: "module" });
      } catch (e) {
        console.error("Janitor: recycle bin worker failed", e);
        resolve({ ok: false, bytes: 0, items: 0 });
        return;
      }
      timer = lazy.setTimeout(
        () => finish({ ok: false, bytes: 0, items: 0 }),
        WORKER_TIMEOUT_MS
      );
      worker.onmessage = event => finish(event.data);
      worker.onerror = () => finish({ ok: false, bytes: 0, items: 0 });
      worker.postMessage({ dryRun });
    });
  }

  /**
   * One toast per group that freed something. They are shown together,
   * stacked under each other, each leaving on its own timer.
   *
   * @param {RunSummary} summary
   * @param {boolean} manual
   */
  async #notify(summary, manual) {
    // A run the user asked for reports everything it freed; the automatic
    // one stays quiet about small amounts.
    const toasts = summary.groups
      .filter(g => (manual ? g.bytes > 0 || g.files > 0 : g.bytes >= MIN_TOAST_BYTES))
      .map(g => ({
        messageId: `peppermint-janitor-toast-${g.group}`,
        size: formatSize(g.bytes),
      }));
    if (manual && summary.errors) {
      toasts.push({ messageId: "peppermint-janitor-toast-errors" });
    }
    if (!toasts.length && manual) {
      toasts.push({ messageId: "peppermint-janitor-toast-nothing" });
    }
    const win = Services.wm.getMostRecentBrowserWindow();
    if (!win?.gZenUIManager) {
      return;
    }
    await Promise.all(
      toasts.map(async ({ messageId, size }, index) => {
        await sleep(index * TOAST_STAGGER_MS);
        if (win.closed) {
          return;
        }
        await win.gZenUIManager.showToast(messageId, {
          descriptionId: size
            ? "peppermint-janitor-toast-description"
            : messageId === "peppermint-janitor-toast-errors"
              ? "peppermint-janitor-toast-errors-description"
              : "peppermint-janitor-toast-nothing-description",
          size,
          timeout: TOAST_TIMEOUT_MS,
          frosted: true,
          icon: CHECK_ICON,
        });
      })
    );
  }
}

export const PeppermintJanitor = new PeppermintJanitorImpl();
