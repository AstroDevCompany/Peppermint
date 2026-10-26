/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { PERIOD_DAYS, collectReport, hostFromReversed, periodBounds } =
  ChromeUtils.importESModule(
    "moz-src:///peppermint/report/PeppermintReport.sys.mjs"
  );
const {
  bumpReport,
  dayKey,
  flushReportStore,
  resetReportStoreForTests,
  sumReport,
} = ChromeUtils.importESModule(
  "moz-src:///peppermint/report/PeppermintReportStore.sys.mjs"
);

add_task(function test_day_keys_and_periods() {
  const noon = new Date(2026, 9, 28, 12).getTime();
  Assert.equal(dayKey(noon), "2026-10-28");
  const week = periodBounds(noon, PERIOD_DAYS.week);
  Assert.equal(week.fromKey, "2026-10-22", "A week reaches six days back");
  Assert.equal(week.toKey, "2026-10-28");
  Assert.equal(new Date(week.fromMs).getHours(), 0, "It starts at midnight");
  Assert.equal(periodBounds(noon, 1).fromKey, "2026-10-28", "One day is today");
});

add_task(function test_reversed_hosts() {
  Assert.equal(hostFromReversed("moc.elpmaxe."), "example.com");
  Assert.equal(hostFromReversed("moc.elpmaxe.www."), "example.com");
  Assert.equal(hostFromReversed("gro.allizom.pord."), "dorp.mozilla.org");
});

add_task(async function test_counters_add_up_and_persist() {
  const today = dayKey();
  const before = await sumReport(today, today);
  await bumpReport("banners", 3);
  await bumpReport("banners");
  await bumpReport("unloaded", 2);
  await bumpReport("activeMs", 60000);
  await bumpReport("nonsense", 5);
  await bumpReport("archived", -4);

  const after = await sumReport(today, today);
  Assert.equal(after.banners - before.banners, 4);
  Assert.equal(after.unloaded - before.unloaded, 2);
  Assert.equal(after.activeMs - before.activeMs, 60000);
  Assert.equal(
    after.archived - before.archived,
    0,
    "Negative amounts are ignored"
  );
  Assert.ok(!("nonsense" in after), "Unknown counters are ignored");

  await flushReportStore();
  resetReportStoreForTests();
  const reread = await sumReport(today, today);
  Assert.deepEqual(reread, after, "The counters survive a restart");
});

add_task(async function test_report_collects_everything() {
  await bumpReport("unloaded", 2);
  const report = await collectReport(PERIOD_DAYS.week, { withHistory: false });
  for (const field of [
    "activeMs",
    "banners",
    "unloaded",
    "archived",
    "trackers",
    "memoryMb",
  ]) {
    Assert.equal(typeof report[field], "number", `${field} is a number`);
  }
  Assert.ok(report.memoryMb > 0, "Unloaded tabs are turned into memory");
  Assert.deepEqual(report.topSites, [], "History is left out on request");

  const full = await collectReport(PERIOD_DAYS.week);
  Assert.ok(Array.isArray(full.topSites));
});
