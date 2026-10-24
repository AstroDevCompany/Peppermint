/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { ADBLOCKERS, DEFAULT_ADBLOCKER, PeppermintAdblocker } =
  ChromeUtils.importESModule(
    "moz-src:///peppermint/adblocker/PeppermintAdblocker.sys.mjs"
  );

const PREF = "peppermint.adblocker.selected";

add_task(function test_catalog_lists_the_four_blockers() {
  Assert.deepEqual(
    ADBLOCKERS.map(blocker => blocker.name),
    ["uBlock Origin", "AdGuard AdBlocker", "Ghostery", "AdBlock"],
    "the four ad blockers are offered"
  );
  Assert.equal(
    new Set(ADBLOCKERS.map(blocker => blocker.id)).size,
    ADBLOCKERS.length,
    "every ad blocker has its own extension id"
  );
  Assert.equal(DEFAULT_ADBLOCKER, "adblock", "AdBlock is the default");
});

add_task(async function test_selection_follows_the_pref() {
  Assert.equal(
    Services.prefs.getStringPref(PREF),
    DEFAULT_ADBLOCKER,
    "the pref defaults to AdBlock"
  );
  Assert.equal(PeppermintAdblocker.selected.name, "AdBlock");

  await SpecialPowers.pushPrefEnv({ set: [[PREF, "ghostery"]] });
  Assert.equal(PeppermintAdblocker.selected.name, "Ghostery");

  await SpecialPowers.pushPrefEnv({ set: [[PREF, "no-such-blocker"]] });
  Assert.equal(
    PeppermintAdblocker.selected.key,
    DEFAULT_ADBLOCKER,
    "an unknown value falls back to the default"
  );
  await SpecialPowers.popPrefEnv();
  await SpecialPowers.popPrefEnv();
});

add_task(function test_unknown_blocker_is_refused() {
  Assert.throws(
    () => PeppermintAdblocker.select("no-such-blocker"),
    /Unknown ad blocker/,
    "an unknown key is refused"
  );
  Assert.equal(
    Services.prefs.getStringPref(PREF),
    DEFAULT_ADBLOCKER,
    "and the selection is left alone"
  );
});
