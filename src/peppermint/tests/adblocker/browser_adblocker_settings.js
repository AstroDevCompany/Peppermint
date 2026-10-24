/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(async function test_settings_list_the_blockers() {
  const tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "about:preferences#adblock"
  );
  try {
    const browser = tab.linkedBrowser;
    await TestUtils.waitForCondition(
      () =>
        SpecialPowers.spawn(
          browser,
          [],
          () => !!content.document.querySelector("#zenAdblocker menuitem")
        ),
      "the ad blocker list is filled"
    );
    const state = await SpecialPowers.spawn(browser, [], () => {
      const list = content.document.getElementById("zenAdblocker");
      return {
        options: [...list.querySelectorAll("menuitem")].map(item => [
          item.value,
          item.label,
        ]),
        value: list.value,
      };
    });
    Assert.deepEqual(
      state.options,
      [
        ["ublock", "uBlock Origin"],
        ["adguard", "AdGuard AdBlocker"],
        ["ghostery", "Ghostery"],
        ["adblock", "AdBlock"],
      ],
      "all four ad blockers can be chosen"
    );
    Assert.equal(state.value, "adblock", "the current choice is selected");
  } finally {
    BrowserTestUtils.removeTab(tab);
  }
});
