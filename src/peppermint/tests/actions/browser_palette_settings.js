/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { registerPeppermintActions, peppermintActions } =
  ChromeUtils.importESModule(
    "moz-src:///peppermint/common/PeppermintActions.sys.mjs"
  );
const { SETTINGS } = ChromeUtils.importESModule(
  "moz-src:///peppermint/palette/PeppermintPaletteSettings.sys.mjs"
);
const { globalActions } = ChromeUtils.importESModule(
  "resource:///modules/ZenUBGlobalActions.sys.mjs"
);

function byId(id) {
  return peppermintActions().find(action => action.commandId === id);
}

function settingActions(setting) {
  const prefix = `peppermint:setting-${setting.id}-`;
  return peppermintActions().filter(action =>
    action.commandId.startsWith(prefix)
  );
}

add_task(function test_every_setting_is_wired_up() {
  registerPeppermintActions();
  for (const setting of SETTINGS) {
    const type = Services.prefs.getPrefType(setting.pref);
    Assert.notEqual(
      type,
      Services.prefs.PREF_INVALID,
      `${setting.pref} exists`
    );
    const actions = settingActions(setting);
    Assert.equal(
      actions.length,
      setting.choices ? setting.choices.length : 2,
      `${setting.id} has an action for each way to change it`
    );
    for (const entry of actions) {
      ok(entry.label.length, `${entry.commandId} has a label`);
      ok(
        !entry.label.includes("peppermint-"),
        `${entry.commandId} label is translated`
      );
      ok(
        globalActions.some(candidate => candidate.commandId == entry.commandId),
        `${entry.commandId} is in the palette`
      );
    }
    if (setting.choices) {
      const kinds = {
        [Services.prefs.PREF_INT]: "number",
        [Services.prefs.PREF_STRING]: "string",
      };
      for (const choice of setting.choices) {
        Assert.equal(
          typeof choice.value,
          kinds[type],
          `${setting.id}/${choice.id} matches the type of ${setting.pref}`
        );
      }
    } else {
      Assert.equal(
        type,
        Services.prefs.PREF_BOOL,
        `${setting.pref} is a boolean`
      );
    }
  }
});

add_task(async function test_boolean_setting_offers_the_other_state() {
  const pref = "privacy.donottrackheader.enabled";
  const on = byId("peppermint:setting-do-not-track-on");
  const off = byId("peppermint:setting-do-not-track-off");
  await SpecialPowers.pushPrefEnv({ set: [[pref, false]] });
  ok(on.isAvailable(window), "Enabling is offered while it is off");
  ok(!off.isAvailable(window), "Disabling is not");
  on.command(window);
  ok(Services.prefs.getBoolPref(pref), "Enabling turns the pref on");
  ok(!on.isAvailable(window), "Enabling is no longer offered");
  ok(off.isAvailable(window), "Disabling is");
  off.command(window);
  ok(!Services.prefs.getBoolPref(pref), "Disabling turns the pref off");
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_choice_setting_offers_the_other_choices() {
  const pref = "browser.startup.page";
  const homepage = byId("peppermint:setting-startup-page-homepage");
  const restore = byId("peppermint:setting-startup-page-previous-session");
  await SpecialPowers.pushPrefEnv({ set: [[pref, 1]] });
  ok(!homepage.isAvailable(window), "The current choice is not offered");
  ok(restore.isAvailable(window), "The other choice is");
  restore.command(window);
  Assert.equal(Services.prefs.getIntPref(pref), 3, "The choice is stored");
  ok(homepage.isAvailable(window), "The old choice is offered again");
  ok(!restore.isAvailable(window), "The new choice no longer is");
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_locked_setting_is_not_offered() {
  const pref = "general.smoothScroll";
  const on = byId("peppermint:setting-smooth-scrolling-on");
  const off = byId("peppermint:setting-smooth-scrolling-off");
  await SpecialPowers.pushPrefEnv({ set: [[pref, false]] });
  ok(on.isAvailable(window), "Offered while unlocked");
  Services.prefs.lockPref(pref);
  try {
    ok(!on.isAvailable(window), "Not offered while locked");
    ok(!off.isAvailable(window), "Neither is the opposite");
  } finally {
    Services.prefs.unlockPref(pref);
  }
  await SpecialPowers.popPrefEnv();
});
