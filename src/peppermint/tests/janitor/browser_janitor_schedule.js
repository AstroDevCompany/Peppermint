/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// Runs here use a folder of their own as the whole machine, like the main
// Janitor tests; nothing points at the real temp folder or caches.

const { PeppermintJanitor, PREFS } = ChromeUtils.importESModule(
  "moz-src:///peppermint/janitor/PeppermintJanitor.sys.mjs"
);
const {
  SCHEDULE_INTERVAL_MS,
  getHistory,
  isRunDue,
  lastRunAt,
  recordRun,
  resetHistoryForTests,
  summarizeHistory,
} = ChromeUtils.importESModule(
  "moz-src:///peppermint/janitor/PeppermintJanitorHistory.sys.mjs"
);
const { normalizePath } = ChromeUtils.importESModule(
  "moz-src:///peppermint/janitor/PeppermintJanitorTargets.sys.mjs"
);

const HOUR = 60 * 60 * 1000;
const MIB = 1024 * 1024;
const HISTORY_FILE = PathUtils.join(PathUtils.profileDir, "janitor-history.json");

async function resetHistory() {
  await IOUtils.remove(HISTORY_FILE, { ignoreAbsent: true });
  resetHistoryForTests();
}

add_setup(async function () {
  await resetHistory();
  registerCleanupFunction(async () => {
    Services.prefs.clearUserPref(PREFS.enabled);
    Services.prefs.clearUserPref(PREFS.schedule);
    await resetHistory();
  });
});

function summary(overrides = {}) {
  return {
    dryRun: false,
    totalBytes: 5 * MIB,
    errors: 0,
    groups: [
      { group: "temp", bytes: 3 * MIB, files: 4, units: 1 },
      { group: "caches", bytes: 2 * MIB, files: 2, units: 1 },
    ],
    ...overrides,
  };
}

add_task(function test_due_check() {
  const now = 1_000_000_000_000;
  Assert.ok(isRunDue("startup", now - 1000, now), "every launch is always due");
  Assert.ok(isRunDue("nonsense", now - 1000, now), "an unknown schedule acts like it");
  Assert.ok(isRunDue("daily", null, now), "a first run is due");
  Assert.ok(!isRunDue("daily", now - 23 * HOUR, now), "daily waits a day");
  Assert.ok(isRunDue("daily", now - SCHEDULE_INTERVAL_MS.daily, now), "and runs after it");
  Assert.ok(!isRunDue("weekly", now - 6 * 24 * HOUR, now), "weekly waits a week");
  Assert.ok(isRunDue("weekly", now - 8 * 24 * HOUR, now), "and runs after it");
});

add_task(async function test_history_records_runs() {
  await resetHistory();
  Assert.equal(await lastRunAt(), null, "there is no last run at first");

  await recordRun(summary(), { now: 1000 });
  await recordRun(summary({ totalBytes: MIB, groups: [] }), {
    now: 2000,
    manual: true,
  });
  await recordRun(summary({ dryRun: true }), { now: 3000 });

  const runs = await getHistory();
  Assert.equal(runs.length, 2, "dry runs are not recorded");
  Assert.equal(await lastRunAt(), 2000, "the last run is the latest one");
  Assert.deepEqual(
    runs[0].groups,
    { temp: { bytes: 3 * MIB, files: 4 }, caches: { bytes: 2 * MIB, files: 2 } },
    "each group's share is kept"
  );
  Assert.equal(runs[0].files, 6, "files add up");
  Assert.ok(runs[1].manual, "a manual run is marked");

  const totals = summarizeHistory(runs);
  Assert.equal(totals.runs, 2);
  Assert.equal(totals.bytes, 6 * MIB, "bytes add up over runs");
  Assert.equal(totals.since, 1000, "since is the first run");
  Assert.equal(totals.lastRun.at, 2000);

  // The file is what a restart would read.
  resetHistoryForTests();
  Assert.equal((await getHistory()).length, 2, "history survives a restart");
});

add_task(async function test_history_is_capped() {
  await resetHistory();
  for (let i = 1; i <= 95; i++) {
    await recordRun(summary(), { now: i });
  }
  const runs = await getHistory();
  Assert.equal(runs.length, 90, "only the latest runs are kept");
  Assert.equal(runs[0].at, 6, "the oldest ones are dropped");
  Assert.equal(summarizeHistory([]).lastRun, null, "no runs, no last run");
});

async function scenarioMachine(name) {
  const root = await IOUtils.createUniqueDirectory(PathUtils.tempDir, name);
  const base = normalizePath(root);
  registerCleanupFunction(() =>
    IOUtils.remove(base, { recursive: true, ignoreAbsent: true })
  );
  const os = Services.appinfo.OS;
  const home = PathUtils.join(base, "home");
  const tmp = PathUtils.join(base, "tmp");
  await IOUtils.makeDirectory(tmp, { createAncestors: true });
  await IOUtils.makeDirectory(home, { createAncestors: true });
  const environment =
    os === "Darwin"
      ? { os, home, tmp, extraTmp: [] }
      : { os, home, tmp, xdgCache: PathUtils.join(home, ".cache"), xdgData: PathUtils.join(home, ".local", "share"), localAppData: PathUtils.join(home, "AppData", "Local"), appData: PathUtils.join(home, "AppData", "Roaming") };
  return { run: { environment, protectedTrees: [], protectedFolders: [], notify: false, groups: ["temp"] } };
}

add_task(async function test_run_if_due_follows_the_schedule() {
  await resetHistory();
  const { run } = await scenarioMachine("janitor-schedule");

  Services.prefs.setBoolPref(PREFS.enabled, false);
  Services.prefs.setStringPref(PREFS.schedule, "startup");
  Assert.equal(
    await PeppermintJanitor.runIfDue({ atStart: true, run }),
    null,
    "nothing runs while the Janitor is off"
  );

  Services.prefs.setBoolPref(PREFS.enabled, true);
  Assert.equal(
    await PeppermintJanitor.runIfDue({ atStart: false, run }),
    null,
    "'every launch' does not run again later in the session"
  );
  Assert.ok(
    await PeppermintJanitor.runIfDue({ atStart: true, run }),
    "'every launch' runs at start"
  );
  Assert.equal((await getHistory()).length, 1, "and the run is remembered");

  Services.prefs.setStringPref(PREFS.schedule, "daily");
  Assert.equal(
    await PeppermintJanitor.runIfDue({ atStart: true, run }),
    null,
    "a daily schedule skips a run that happened minutes ago"
  );

  // Pretend the last run was two days ago.
  const runs = await getHistory();
  runs[runs.length - 1].at = Date.now() - 48 * HOUR;
  Assert.ok(
    await PeppermintJanitor.runIfDue({ atStart: false, run }),
    "a daily schedule runs once a day has passed, even mid-session"
  );
  Assert.ok(
    Date.now() - (await lastRunAt()) < HOUR,
    "and the run time is updated"
  );
});

add_task(async function test_settings_show_schedule_and_history() {
  Services.prefs.clearUserPref(PREFS.enabled);
  Services.prefs.clearUserPref(PREFS.schedule);
  await resetHistory();
  await recordRun(summary(), { now: Date.now() - HOUR });
  await recordRun(summary({ totalBytes: 2 * MIB, groups: [
    { group: "temp", bytes: 2 * MIB, files: 1, units: 1 },
  ] }));

  const tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "about:preferences#janitor"
  );
  try {
    const browser = tab.linkedBrowser;
    await TestUtils.waitForCondition(
      () =>
        SpecialPowers.spawn(browser, [], () => {
          const last = content.document.getElementById("zenJanitorLastRun");
          return last?.getAttribute("data-l10n-id") === "zen-janitor-last-run";
        }),
      "the dashboard shows the last run"
    );
    const state = await SpecialPowers.spawn(browser, [], () => {
      const doc = content.document;
      const totals = doc.getElementById("zenJanitorTotals");
      return {
        scheduleValue: doc.getElementById("zenJanitorSchedule").value,
        options: [...doc.querySelectorAll("#zenJanitorSchedule menuitem")].map(
          item => item.value
        ),
        totalsHidden: totals.hidden,
        totalsArgs: totals.getAttribute("data-l10n-args"),
        cleanNowDisabled: doc.getElementById("zenJanitorCleanNow").disabled,
      };
    });
    Assert.equal(state.scheduleValue, "startup", "the schedule starts as every launch");
    Assert.deepEqual(state.options, ["startup", "daily", "weekly"], "all schedules are offered");
    Assert.ok(!state.totalsHidden, "the totals are shown once something was cleaned");
    Assert.ok(JSON.parse(state.totalsArgs).count === 2, "they count both runs");
    Assert.ok(!state.cleanNowDisabled, "Clean now works while automatic cleaning is off");
  } finally {
    BrowserTestUtils.removeTab(tab);
    await resetHistory();
  }
});
