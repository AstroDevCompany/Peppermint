/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { shortcutNumberForIndex } = ChromeUtils.importESModule(
  "moz-src:///peppermint/tab-numbers/PeppermintTabNumbers.sys.mjs"
);

const MODIFIER_KEY = {
  macosx: { key: "Meta", metaKey: true },
  linux: { key: "Alt", altKey: true },
  win: { key: "Control", ctrlKey: true },
}[AppConstants.platform];

function numberLabels() {
  return [...document.querySelectorAll(".peppermint-tab-number")].map(
    label => label.textContent
  );
}

add_task(function test_numbering() {
  Assert.equal(shortcutNumberForIndex(3, 0), 1, "First tab is 1");
  Assert.equal(shortcutNumberForIndex(8, 7), 8, "Eighth tab is 8");
  Assert.equal(shortcutNumberForIndex(9, 8), 9, "Ninth tab is the last, 9");
  Assert.equal(shortcutNumberForIndex(12, 8), null, "Middle tabs have none");
  Assert.equal(shortcutNumberForIndex(12, 11), 9, "The last tab is 9");
});

add_task(async function test_numbers_follow_the_modifier() {
  // Let the window finish its start-up animations first.
  await new Promise(resolve => setTimeout(resolve, 500));
  const original = new Set(gBrowser.tabs);
  for (let i = 0; i < 3; i++) {
    BrowserTestUtils.addTab(gBrowser, "about:blank");
  }
  // Let the new tabs finish animating in before the modifier goes down.
  await new Promise(resolve => setTimeout(resolve, 500));
  Assert.deepEqual(numberLabels(), [], "No numbers before the modifier");

  EventUtils.synthesizeKey(MODIFIER_KEY.key, {
    type: "keydown",
    ...MODIFIER_KEY,
  });
  await TestUtils.waitForCondition(
    () => numberLabels().length,
    "Numbers appear while the modifier is held"
  );
  const visible = gBrowser.visibleTabs.length;
  Assert.equal(numberLabels().length, Math.min(visible, 9), "One per tab");
  Assert.equal(numberLabels()[0], "1", "Numbering starts at 1");
  Assert.ok(
    document.querySelector(".tab-icon-stack[peppermint-tab-number]"),
    "The icon is flagged as replaced"
  );

  EventUtils.synthesizeKey(MODIFIER_KEY.key, { type: "keyup" });
  Assert.deepEqual(numberLabels(), [], "Numbers go when it is released");
  Assert.ok(
    !document.querySelector(".tab-icon-stack[peppermint-tab-number]"),
    "The icon is shown again"
  );

  // Zen may open a replacement tab of its own when the others close.
  for (const tab of gBrowser.tabs.filter(t => !original.has(t))) {
    await BrowserTestUtils.removeTab(tab, { animate: false });
  }
});
