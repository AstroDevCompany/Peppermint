/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

ChromeUtils.defineESModuleGetters(this, {
  UrlbarTestUtils: "resource://testing-common/UrlbarTestUtils.sys.mjs",
});

// Command+T opens the URL bar floating over the page, even when the bar was
// last focused by a mouse click
// and never blurred (a stale focusedViaMousedown kept it docked in the
// sidebar until the person started typing).

add_setup(async function () {
  await gZenWorkspaces.promiseInitialized;
  gZenHomepage?.init();
});

add_task(async function test_new_tab_urlbar_floats_after_mouse_focus() {
  const emptyTab = gZenWorkspaces._emptyTab;
  ok(emptyTab, "Empty tab exists");
  gBrowser.selectedTab = emptyTab;
  gZenHomepage.sync();
  const homepage = document.getElementById("zen-homepage");
  ok(!homepage.hidden, "The homepage is showing on the empty tab");

  gURLBar.focusedViaMousedown = true;

  const closeToken = {};
  await UrlbarTestUtils.promisePopupOpen(window, () => {
    ok(
      gZenUIManager.handleNewTab(false, false, "tab", true, closeToken),
      "The new tab URL bar session opened"
    );
  });

  // Anything that wants the view closed does so within a few event loop turns
  // and animation frames.
  await new Promise(resolve => setTimeout(resolve, 1000));

  info(
    JSON.stringify({
      breakout: gURLBar.hasAttribute("breakout-extend"),
      floating: gURLBar.hasAttribute("zen-floating-urlbar"),
      newtab: gURLBar.hasAttribute("zen-newtab"),
      popover: gURLBar.matches(":popover-open"),
      viewOpen: gURLBar.view.isOpen,
      rows: gURLBar.view.visibleRowCount,
      focused: gURLBar.focused,
      selectedEmpty: gBrowser.selectedTab.hasAttribute("zen-empty-tab"),
    })
  );

  ok(gURLBar.hasAttribute("breakout-extend"), "The URL bar is expanded");
  ok(
    gURLBar.hasAttribute("zen-floating-urlbar"),
    "The URL bar floats over the page"
  );
  ok(gURLBar.hasAttribute("zen-newtab"), "The new tab session is still active");
  ok(gURLBar.focused, "The URL bar is focused");
  ok(gURLBar.view.isOpen, "The results view is open");

  gURLBar._zenHandleUrlbarClose?.();
  await TestUtils.waitForCondition(
    () => !gURLBar.hasAttribute("zen-newtab"),
    "The session closed"
  );
});
