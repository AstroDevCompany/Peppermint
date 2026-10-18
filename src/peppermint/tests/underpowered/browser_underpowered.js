/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const PREF_ENABLED = "zen.underpowered.enabled";
const PREF_SAVED = "zen.underpowered.saved-prefs";
const PREF_AUTO = "zen.underpowered.auto-on-battery";
const PREF_AUTO_ENABLED = "zen.underpowered.auto-enabled";
const PREF_AUTO_RESOURCES = "zen.underpowered.auto-on-resources";
const PREF_THRESHOLD = "zen.underpowered.battery-threshold";

const { ZenUnderpowered } = ChromeUtils.importESModule(
  "moz-src:///peppermint/underpowered/ZenUnderpowered.sys.mjs"
);
const TUNED_PREF = "image.animation_mode";
const FOOT_BUTTONS = "zen-sidebar-foot-buttons";

function button() {
  return document.getElementById("zen-underpowered-button");
}

function announcement() {
  return [...document.querySelectorAll("#zen-toast-container .zen-toast")].find(
    toast =>
      toast.querySelector("label")?.getAttribute("data-l10n-id") ===
      "zen-underpowered-enabled-toast"
  );
}

function isFrozen(tab) {
  return tab.hasAttribute("pending") && !tab.linkedPanel;
}

async function openLoadedTab(url, { selected }) {
  if (selected) {
    return BrowserTestUtils.openNewForegroundTab(gBrowser, url);
  }
  const tab = BrowserTestUtils.addTab(gBrowser, url);
  await BrowserTestUtils.browserLoaded(tab.linkedBrowser, false, url);
  return tab;
}

function setUnderpowered(enabled) {
  const node = button();
  is(
    node.getAttribute("aria-pressed"),
    String(!enabled),
    "The button shows the state it is about to leave"
  );
  node.doCommand();
  is(
    Services.prefs.getBoolPref(PREF_ENABLED),
    enabled,
    "The button toggles the pref"
  );
}

add_task(async function test_button_sits_after_ghost_mode() {
  const placement = CustomizableUI.getPlacementOfWidget(
    "zen-underpowered-button"
  );
  is(placement?.area, FOOT_BUTTONS, "The button is in the sidebar foot");
  const ghost = CustomizableUI.getPlacementOfWidget("zen-ghost-mode-button");
  if (ghost?.area === FOOT_BUTTONS) {
    is(
      placement.position,
      ghost.position + 1,
      "The button sits right after Ghost mode"
    );
  }
  ok(button(), "The button is in the window");
  ok(!button().hasAttribute("checked"), "The button starts unchecked");
});

add_task(async function test_freeze_switch_and_restore() {
  const originalMode = Services.prefs.getStringPref(TUNED_PREF);
  const hadUserValue = Services.prefs.prefHasUserValue(TUNED_PREF);

  const unloadedBefore = await openLoadedTab("https://example.com/?before", {
    selected: false,
  });
  await gBrowser.prepareDiscardBrowser(unloadedBefore);
  ok(gBrowser.discardBrowser(unloadedBefore), "The first tab is unloaded");
  const background = await openLoadedTab("https://example.org/", {
    selected: false,
  });
  const selected = await openLoadedTab("https://example.com/?selected", {
    selected: true,
  });
  ok(isFrozen(unloadedBefore), "The first tab starts unloaded");
  ok(!isFrozen(background), "The background tab starts loaded");

  registerCleanupFunction(() => {
    Services.prefs.clearUserPref(PREF_ENABLED);
    for (const tab of [unloadedBefore, background, selected]) {
      if (!tab.closing && tab.isConnected) {
        BrowserTestUtils.removeTab(tab);
      }
    }
  });

  setUnderpowered(true);
  ok(button().hasAttribute("checked"), "The button is checked");
  ok(announcement()?.hasAttribute("frosted"), "A frosted toast announces it");
  ok(
    document.documentElement.hasAttribute("zen-underpowered"),
    "The window is marked underpowered"
  );
  is(Services.prefs.getStringPref(TUNED_PREF), "none", "The pref is tuned");
  ok(
    Services.prefs.prefHasUserValue(PREF_SAVED),
    "The original prefs are saved"
  );

  await TestUtils.waitForCondition(
    () => isFrozen(background),
    "The background tab is frozen"
  );
  ok(!isFrozen(selected), "The selected tab stays loaded");

  await BrowserTestUtils.switchTab(gBrowser, background);
  await TestUtils.waitForCondition(
    () => !isFrozen(background) && !background.hasAttribute("busy"),
    "The tab switched to comes back"
  );
  await TestUtils.waitForCondition(
    () => isFrozen(selected),
    "The tab left behind is frozen"
  );
  ok(!isFrozen(background), "The newly selected tab stays loaded");

  await TestUtils.waitForCondition(
    () => !announcement(),
    "The announcement hides on its own"
  );
  setUnderpowered(false);
  ok(!button().hasAttribute("checked"), "The button is unchecked");
  ok(!announcement(), "Turning it off is not announced");
  ok(
    !document.documentElement.hasAttribute("zen-underpowered"),
    "The window is no longer marked underpowered"
  );
  is(
    Services.prefs.getStringPref(TUNED_PREF),
    originalMode,
    "The tuned pref is restored"
  );
  is(
    Services.prefs.prefHasUserValue(TUNED_PREF),
    hadUserValue,
    "The pref is back on the branch it came from"
  );
  ok(
    !Services.prefs.prefHasUserValue(PREF_SAVED),
    "The saved prefs are cleared"
  );

  await TestUtils.waitForCondition(
    () => !isFrozen(selected),
    "The frozen tab is loaded again without being visited"
  );
  await TestUtils.waitForCondition(
    () =>
      selected.linkedBrowser.currentURI.spec ===
      "https://example.com/?selected",
    "The frozen tab comes back to its page"
  );
  ok(isFrozen(unloadedBefore), "A tab unloaded before stays unloaded");
});

class FakeBattery extends EventTarget {
  level = 1;
  charging = true;

  setState({ level, charging } = {}) {
    const levelChanged = level !== undefined && level !== this.level;
    const chargingChanged =
      charging !== undefined && charging !== this.charging;
    if (level !== undefined) {
      this.level = level;
    }
    if (charging !== undefined) {
      this.charging = charging;
    }
    if (chargingChanged) {
      this.dispatchEvent(new Event("chargingchange"));
    }
    if (levelChanged) {
      this.dispatchEvent(new Event("levelchange"));
    }
  }
}

add_task(async function test_battery_auto_enable_respects_ownership() {
  ZenUnderpowered.init();
  const battery = new FakeBattery();
  ZenUnderpowered._batterySource = () => battery;
  Services.prefs.setBoolPref(PREF_AUTO, true);
  await ZenUnderpowered.syncBatteryForTests();
  registerCleanupFunction(() => {
    ZenUnderpowered._batterySource = null;
    Services.prefs.setBoolPref(PREF_AUTO, false);
    Services.prefs.clearUserPref(PREF_AUTO_ENABLED);
    Services.prefs.clearUserPref(PREF_ENABLED);
  });

  battery.setState({ level: 0.1, charging: false });
  ok(
    Services.prefs.getBoolPref(PREF_ENABLED),
    "A low battery turns the mode on"
  );
  ok(
    Services.prefs.getBoolPref(PREF_AUTO_ENABLED),
    "The session is marked as automatic"
  );

  battery.setState({ charging: true });
  ok(
    !Services.prefs.getBoolPref(PREF_ENABLED),
    "Plugging in turns the automatic session off"
  );
  ok(
    !Services.prefs.getBoolPref(PREF_AUTO_ENABLED),
    "Plugging in clears ownership"
  );

  battery.setState({ level: 0.1, charging: false });
  ok(
    Services.prefs.getBoolPref(PREF_ENABLED),
    "Unplugging below the threshold turns it on again"
  );

  Services.prefs.setBoolPref(PREF_ENABLED, false);
  battery.setState({ level: 0.05 });
  ok(
    !Services.prefs.getBoolPref(PREF_ENABLED),
    "A dismissed automatic session stays off while still unplugged"
  );

  battery.setState({ charging: true });
  battery.setState({ level: 0.05, charging: false });
  ok(
    Services.prefs.getBoolPref(PREF_ENABLED),
    "After charging, a low battery may turn it on again"
  );

  battery.setState({ level: 0.9, charging: true });
  Services.prefs.setBoolPref(PREF_ENABLED, true);
  battery.setState({ level: 0.95 });
  ok(
    Services.prefs.getBoolPref(PREF_ENABLED),
    "A session the user turned on stays on while charging"
  );
  ok(
    !Services.prefs.getBoolPref(PREF_AUTO_ENABLED),
    "A manual session is not owned by the battery watcher"
  );

  Services.prefs.setBoolPref(PREF_ENABLED, false);
  Services.prefs.setBoolPref(PREF_AUTO, false);
  await ZenUnderpowered.syncBatteryForTests();
});

add_task(async function test_defaults_enable_both_triggers() {
  const defaults = Services.prefs.getDefaultBranch("");
  ok(
    defaults.getBoolPref(PREF_AUTO),
    "Low battery auto-enable is on by default"
  );
  ok(
    defaults.getBoolPref(PREF_AUTO_RESOURCES),
    "High resource use auto-enable is on by default"
  );
  is(defaults.getIntPref(PREF_THRESHOLD), 30, "The battery threshold is 30%");
});

add_task(async function test_resources_auto_enable_and_settle() {
  ZenUnderpowered.init();
  const monitor = ZenUnderpowered.resourceMonitorForTests;
  // Readings come from feed(); the real poll never answers.
  monitor._sampleSource = () => new Promise(() => {});
  Services.prefs.setBoolPref(PREF_AUTO_RESOURCES, true);
  ZenUnderpowered.syncResourcesForTests();
  registerCleanupFunction(() => {
    monitor._sampleSource = null;
    Services.prefs.setBoolPref(PREF_AUTO_RESOURCES, false);
    ZenUnderpowered.syncResourcesForTests();
    Services.prefs.clearUserPref(PREF_AUTO_ENABLED);
    Services.prefs.clearUserPref(PREF_ENABLED);
  });
  const feed = (cpu, ram, seconds) =>
    monitor.feed({ cpu, ram }, seconds * 1000);

  feed(95, 40, 0);
  feed(95, 40, 5);
  ok(
    !Services.prefs.getBoolPref(PREF_ENABLED),
    "A short CPU peak does not turn the mode on"
  );
  feed(40, 40, 10);
  feed(95, 40, 15);
  feed(95, 40, 20);
  ok(
    !Services.prefs.getBoolPref(PREF_ENABLED),
    "Peaks that are not back to back do not add up"
  );
  feed(40, 92, 25);
  ok(
    Services.prefs.getBoolPref(PREF_ENABLED),
    "Sustained high RAM turns the mode on"
  );
  ok(
    Services.prefs.getBoolPref(PREF_AUTO_ENABLED),
    "The session is marked as automatic"
  );

  feed(40, 40, 30);
  feed(40, 40, 59);
  ok(
    Services.prefs.getBoolPref(PREF_ENABLED),
    "It stays on until the load has been calm for 30 seconds"
  );
  feed(95, 40, 60);
  feed(40, 40, 65);
  feed(40, 40, 94);
  ok(
    Services.prefs.getBoolPref(PREF_ENABLED),
    "A new peak restarts the 30 seconds"
  );
  feed(40, 40, 95);
  ok(
    !Services.prefs.getBoolPref(PREF_ENABLED),
    "Thirty calm seconds turn the automatic session off"
  );
  ok(!Services.prefs.getBoolPref(PREF_AUTO_ENABLED), "Ownership is cleared");

  // A session the user started is left alone.
  Services.prefs.setBoolPref(PREF_ENABLED, true);
  feed(99, 40, 100);
  feed(99, 40, 105);
  feed(99, 40, 110);
  feed(10, 10, 115);
  feed(10, 10, 150);
  ok(
    Services.prefs.getBoolPref(PREF_ENABLED),
    "A manual session is never turned off when the load settles"
  );
  Services.prefs.setBoolPref(PREF_ENABLED, false);

  // Turning an automatic session off by hand keeps it off until things settle.
  feed(99, 40, 200);
  feed(99, 40, 205);
  feed(99, 40, 210);
  ok(
    Services.prefs.getBoolPref(PREF_ENABLED),
    "High load turns the mode on again"
  );
  Services.prefs.setBoolPref(PREF_ENABLED, false);
  feed(99, 40, 215);
  ok(
    !Services.prefs.getBoolPref(PREF_ENABLED),
    "A session turned off by the user stays off during the same load"
  );
  feed(10, 10, 220);
  feed(10, 10, 250);
  feed(99, 40, 255);
  feed(99, 40, 260);
  feed(99, 40, 265);
  ok(
    Services.prefs.getBoolPref(PREF_ENABLED),
    "After the load settled, a new peak may turn it on again"
  );
  Services.prefs.setBoolPref(PREF_ENABLED, false);
  feed(10, 10, 270);
  feed(10, 10, 300);
});

add_task(async function test_battery_and_resources_share_one_session() {
  ZenUnderpowered.init();
  const monitor = ZenUnderpowered.resourceMonitorForTests;
  // Readings come from feed(); the real poll never answers.
  monitor._sampleSource = () => new Promise(() => {});
  const battery = new FakeBattery();
  ZenUnderpowered._batterySource = () => battery;
  Services.prefs.setBoolPref(PREF_AUTO, true);
  Services.prefs.setBoolPref(PREF_AUTO_RESOURCES, true);
  await ZenUnderpowered.syncBatteryForTests();
  ZenUnderpowered.syncResourcesForTests();
  registerCleanupFunction(() => {
    ZenUnderpowered._batterySource = null;
    monitor._sampleSource = null;
    Services.prefs.setBoolPref(PREF_AUTO, false);
    Services.prefs.setBoolPref(PREF_AUTO_RESOURCES, false);
    Services.prefs.clearUserPref(PREF_AUTO_ENABLED);
    Services.prefs.clearUserPref(PREF_ENABLED);
  });
  const feed = (cpu, ram, seconds) =>
    monitor.feed({ cpu, ram }, seconds * 1000);

  battery.setState({ level: 0.25, charging: false });
  ok(
    Services.prefs.getBoolPref(PREF_ENABLED),
    "25% battery is under the 30% threshold"
  );

  feed(99, 99, 0);
  feed(99, 99, 5);
  feed(99, 99, 10);
  battery.setState({ charging: true });
  ok(
    Services.prefs.getBoolPref(PREF_ENABLED),
    "Plugging in keeps the session while the load is still very high"
  );
  feed(10, 10, 15);
  feed(10, 10, 45);
  ok(
    !Services.prefs.getBoolPref(PREF_ENABLED),
    "It ends once neither the battery nor the load calls for it"
  );

  battery.setState({ level: 0.9 });
  Services.prefs.setBoolPref(PREF_AUTO_RESOURCES, false);
  ZenUnderpowered.syncResourcesForTests();
  Services.prefs.setBoolPref(PREF_AUTO, false);
  await ZenUnderpowered.syncBatteryForTests();
});

add_task(async function test_worker_reads_system_load() {
  const { AppConstants } = ChromeUtils.importESModule(
    "resource://gre/modules/AppConstants.sys.mjs"
  );
  const worker = new ChromeWorker(
    "resource:///modules/zen/underpowered/ZenUnderpoweredResources.worker.mjs",
    { type: "module" }
  );
  const read = () =>
    new Promise(resolve => {
      worker.onmessage = event => resolve(event.data);
      worker.postMessage({ platform: AppConstants.platform });
    });
  const inRange = value =>
    typeof value === "number" && value >= 0 && value <= 100;

  const first = await read();
  ok(inRange(first.ram), `RAM use is a percentage (${first.ram})`);
  is(first.cpu, null, "CPU needs two readings");
  // Burn a little CPU so the second window is not empty.
  const end = Date.now() + 200;
  while (Date.now() < end) {
    // Spin.
  }
  const second = await read();
  ok(inRange(second.ram), `RAM use is still a percentage (${second.ram})`);
  ok(inRange(second.cpu), `CPU use is a percentage (${second.cpu})`);
  worker.terminate();
});
