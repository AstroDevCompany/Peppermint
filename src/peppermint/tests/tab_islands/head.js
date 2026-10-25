/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { canFormIsland, isIslandId } = ChromeUtils.importESModule(
  "moz-src:///peppermint/tab-islands/PeppermintTabIslands.sys.mjs"
);

function islandOf(tab) {
  const group = tab.group;
  return group?.hasAttribute("peppermint-island") ? group : null;
}

async function openTab(opener) {
  gBrowser.selectedTab = opener;
  return BrowserTestUtils.addTab(gBrowser, "about:blank", {
    relatedToCurrent: true,
    skipAnimation: true,
  });
}

async function openPlainTab() {
  const tab = BrowserTestUtils.addTab(gBrowser, "about:blank", {
    skipAnimation: true,
  });
  gBrowser.selectedTab = tab;
  return tab;
}

async function waitForIsland(tab) {
  await TestUtils.waitForCondition(() => islandOf(tab), "Island forms");
  return islandOf(tab);
}
