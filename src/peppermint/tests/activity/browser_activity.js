/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { PeppermintActivity } = ChromeUtils.importESModule(
  "moz-src:///peppermint/common/PeppermintActivity.sys.mjs",
);
const { ResourceMonitor } = ChromeUtils.importESModule(
  "moz-src:///peppermint/underpowered/ZenUnderpoweredResources.sys.mjs",
);

add_task(async function test_user_idle_and_sleep_flip_the_state() {
  const calls = [];
  const observer = {
    onInactive: () => calls.push("inactive"),
    onActive: () => calls.push("active"),
  };
  PeppermintActivity.addObserver(observer);
  registerCleanupFunction(() => {
    PeppermintActivity.removeObserver(observer);
    PeppermintActivity._force(null);
  });

  ok(!PeppermintActivity.inactive, "A fresh browser counts as active");

  PeppermintActivity.observe(null, "idle", "");
  ok(PeppermintActivity.inactive, "User idle makes it inactive");
  PeppermintActivity.observe(null, "idle", "");
  Assert.deepEqual(calls, ["inactive"], "A repeated signal notifies once");

  PeppermintActivity.observe(null, "active", "");
  ok(!PeppermintActivity.inactive, "Input makes it active again");

  PeppermintActivity.observe(null, "sleep_notification", "");
  ok(PeppermintActivity.inactive, "Sleep makes it inactive");
  PeppermintActivity.observe(null, "wake_notification", "");
  ok(!PeppermintActivity.inactive, "Waking makes it active");

  Assert.deepEqual(
    calls,
    ["inactive", "active", "inactive", "active"],
    "Observers hear every change in order",
  );
});

add_task(async function test_a_throwing_observer_does_not_block_the_rest() {
  const heard = [];
  const bad = {
    onInactive() {
      throw new Error("expected test failure");
    },
  };
  const good = { onInactive: () => heard.push("inactive") };
  PeppermintActivity.addObserver(bad);
  PeppermintActivity.addObserver(good);
  PeppermintActivity._force(true);
  Assert.deepEqual(heard, ["inactive"], "The second observer still runs");
  PeppermintActivity._force(null);
  PeppermintActivity.removeObserver(bad);
  PeppermintActivity.removeObserver(good);
});

add_task(async function test_resource_monitor_stops_reading_while_paused() {
  let reads = 0;
  const monitor = new ResourceMonitor(() => {});
  monitor._sampleSource = () => {
    reads++;
    return { cpu: 10, ram: 10 };
  };
  registerCleanupFunction(() => monitor.stop());

  monitor.start();
  await TestUtils.waitForCondition(() => reads == 1, "First reading is taken");

  monitor.setPaused(true);
  const before = reads;
  await new Promise((resolve) => setTimeout(resolve, 200));
  is(reads, before, "No reading is taken while paused");

  monitor.setPaused(false);
  await TestUtils.waitForCondition(
    () => reads == before + 1,
    "Resuming reads at once",
  );

  monitor.setPaused(true);
  monitor.stop();
  monitor.start();
  const afterRestart = reads;
  await new Promise((resolve) => setTimeout(resolve, 200));
  is(reads, afterRestart, "A restart while paused stays quiet");
  monitor.stop();
});

add_task(async function test_pause_resets_the_sustained_peak_count() {
  const changes = [];
  const monitor = new ResourceMonitor((high) => changes.push(high));
  monitor._sampleSource = () => new Promise(() => {});
  monitor.start();
  monitor.feed({ cpu: 95, ram: 10 }, 0);
  monitor.feed({ cpu: 95, ram: 10 }, 10000);
  monitor.setPaused(true);
  monitor.setPaused(false);
  monitor.feed({ cpu: 95, ram: 10 }, 600000);
  Assert.deepEqual(
    changes,
    [],
    "Readings from before and after a gap do not add up to a peak",
  );
  monitor.stop();
});
