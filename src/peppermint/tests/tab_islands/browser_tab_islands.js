/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(function test_island_ids_and_eligibility() {
  Assert.ok(isIslandId("peppermint-island-1-2"), "Island ids are recognised");
  Assert.ok(!isIslandId("1700000000000-42"), "Native ids are not islands");

  const fake = (attrs = {}) => ({
    isConnected: true,
    closing: false,
    pinned: false,
    group: null,
    splitView: null,
    hasAttribute: name => !!attrs[name],
    getAttribute: name => attrs[name] ?? null,
  });
  Assert.ok(canFormIsland(fake(), fake()), "Two plain tabs can");
  Assert.ok(!canFormIsland(null, fake()), "No opener, no island");
  Assert.ok(
    !canFormIsland({ ...fake(), pinned: true }, fake()),
    "A pinned opener never forms one"
  );
  Assert.ok(
    !canFormIsland(fake({ "zen-essential": "true" }), fake()),
    "An essential opener never forms one"
  );
  Assert.ok(
    !canFormIsland(fake(), fake({ "zen-glance-tab": "true" })),
    "Glance tabs are left alone"
  );
  Assert.ok(
    !canFormIsland(
      fake({ "zen-workspace-id": "a" }),
      fake({ "zen-workspace-id": "b" })
    ),
    "Tabs of different spaces are not joined"
  );
  Assert.ok(
    !canFormIsland({ ...fake(), group: {} }, fake()),
    "An opener already in a group is left alone"
  );
});

add_task(async function test_opening_from_a_tab_forms_an_island() {
  const opener = await openPlainTab();
  const child = await openTab(opener);

  const island = await waitForIsland(child);
  Assert.equal(opener.group, island, "The opener is in the island");
  Assert.equal(island.tabs.length, 2, "The island holds both tabs");
  Assert.ok(!island.saveOnWindowClose, "Islands are not saved on close");

  const second = await openTab(opener);
  await TestUtils.waitForCondition(
    () => second.group == island,
    "A further child joins the same island"
  );
  Assert.equal(island.tabs.length, 3, "The island holds three tabs");

  BrowserTestUtils.removeTab(second);
  BrowserTestUtils.removeTab(child);
  await TestUtils.waitForCondition(
    () => !opener.group,
    "An island left with one tab dissolves"
  );
  BrowserTestUtils.removeTab(opener);
});

add_task(async function test_unrelated_tabs_stay_ungrouped() {
  const first = await openPlainTab();
  const second = await openPlainTab();
  await new Promise(resolve => setTimeout(resolve, 100));
  Assert.ok(!islandOf(first) && !islandOf(second), "No island for new tabs");
  BrowserTestUtils.removeTab(second);
  BrowserTestUtils.removeTab(first);
});

add_task(async function test_pref_turns_islands_off() {
  await SpecialPowers.pushPrefEnv({
    set: [["peppermint.tabs.islands.enabled", false]],
  });
  const opener = await openPlainTab();
  const child = await openTab(opener);
  await new Promise(resolve => setTimeout(resolve, 100));
  Assert.ok(!islandOf(child), "No island while the pref is off");
  BrowserTestUtils.removeTab(child);
  BrowserTestUtils.removeTab(opener);
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_pinned_opener_forms_no_island() {
  const opener = await openPlainTab();
  gBrowser.pinTab(opener);
  const child = await openTab(opener);
  await new Promise(resolve => setTimeout(resolve, 100));
  Assert.ok(!islandOf(child), "A pinned opener does not form an island");
  BrowserTestUtils.removeTab(child);
  gBrowser.unpinTab(opener);
  BrowserTestUtils.removeTab(opener);
});

add_task(async function test_island_name_is_automatic_until_renamed() {
  const opener = await openPlainTab();
  const child = await openTab(opener);
  const island = await waitForIsland(child);
  const nameOf = () =>
    island.querySelector(".peppermint-island-name")?.textContent;

  await TestUtils.waitForCondition(
    () => nameOf() === opener.label,
    "The header shows the first tab's title"
  );
  Assert.ok(
    island.querySelector(".peppermint-island-icon")?.src,
    "The header shows an icon"
  );
  Assert.ok(!island.hasAttribute("peppermint-island-named"), "Unnamed");

  island.label = "Research";
  await TestUtils.waitForCondition(
    () => island.hasAttribute("peppermint-island-named"),
    "A custom name takes over"
  );
  Assert.equal(island.label, "Research", "The custom name is the label");

  island.label = "";
  await TestUtils.waitForCondition(
    () => !island.hasAttribute("peppermint-island-named"),
    "Clearing the name goes back to the automatic one"
  );

  BrowserTestUtils.removeTab(child);
  BrowserTestUtils.removeTab(opener);
});
