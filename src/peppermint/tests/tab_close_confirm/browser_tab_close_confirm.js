/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { PeppermintTabCloseConfirm } = ChromeUtils.importESModule(
  "moz-src:///peppermint/tab-close-confirm/PeppermintTabCloseConfirm.sys.mjs"
);

const BUTTON_PREF = "peppermint.tabs.confirm-close-button";
const MIDDLE_CLICK_PREF = "peppermint.tabs.confirm-close-middle-click";

add_task(async function test_defaults_are_off() {
  const defaults = Services.prefs.getDefaultBranch("");
  Assert.equal(defaults.getBoolPref(BUTTON_PREF), false, "Button is off");
  Assert.equal(
    defaults.getBoolPref(MIDDLE_CLICK_PREF),
    false,
    "Middle click is off"
  );
});

add_task(async function test_which_sources_ask() {
  const cases = [
    { button: false, middle: false, ask: { button: false, middle: false } },
    { button: false, middle: true, ask: { button: false, middle: false } },
    { button: true, middle: false, ask: { button: true, middle: false } },
    { button: true, middle: true, ask: { button: true, middle: true } },
  ];
  for (const { button, middle, ask } of cases) {
    await SpecialPowers.pushPrefEnv({
      set: [
        [BUTTON_PREF, button],
        [MIDDLE_CLICK_PREF, middle],
      ],
    });
    const label = `button=${button} middle=${middle}`;
    Assert.equal(
      PeppermintTabCloseConfirm.isEnabled("button"),
      ask.button,
      `Close button: ${label}`
    );
    Assert.equal(
      PeppermintTabCloseConfirm.isEnabled("middle-click"),
      ask.middle,
      `Middle click: ${label}`
    );
    await SpecialPowers.popPrefEnv();
  }
});

add_task(async function test_no_dialog_when_off() {
  await SpecialPowers.pushPrefEnv({
    set: [
      [BUTTON_PREF, false],
      [MIDDLE_CLICK_PREF, true],
    ],
  });
  Assert.ok(
    PeppermintTabCloseConfirm.confirm(window, "button"),
    "Closing goes ahead without asking"
  );
  Assert.ok(
    PeppermintTabCloseConfirm.confirm(window, "middle-click", 3),
    "Middle click alone does not ask when the button setting is off"
  );
  await SpecialPowers.popPrefEnv();
});
