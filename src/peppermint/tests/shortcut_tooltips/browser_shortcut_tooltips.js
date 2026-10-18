/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { ShortcutUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/ShortcutUtils.sys.mjs"
);

function hover(element) {
  element.dispatchEvent(
    new MouseEvent("mouseover", { bubbles: true, composed: true })
  );
}

async function tooltipOf(element) {
  hover(element);
  await document.l10n.translateElements([element]);
  return element.getAttribute("tooltiptext");
}

add_task(async function test_compact_mode_button() {
  const button = document.querySelector(
    "#zen-toggle-compact-mode toolbarbutton"
  );
  const shortcut = ShortcutUtils.prettifyShortcut(
    document.getElementById("zen-compact-mode-toggle")
  );
  Assert.ok(shortcut, "Compact mode has a shortcut");
  Assert.equal(
    await tooltipOf(button),
    `Toggle Compact Mode (${shortcut})`,
    "The tooltip includes the shortcut"
  );
});

add_task(async function test_close_button() {
  const tab = gBrowser.selectedTab;
  const shortcut = ShortcutUtils.prettifyShortcut(
    document.getElementById("key_close")
  );
  Assert.equal(
    await tooltipOf(tab.querySelector(".tab-close-button")),
    `Close tab (${shortcut})`,
    "The selected tab's close button shows the shortcut"
  );

  const other = BrowserTestUtils.addTab(gBrowser, "about:blank");
  Assert.equal(
    await tooltipOf(other.querySelector(".tab-close-button")),
    "Close tab",
    "A background tab's close button does not, as the shortcut closes the selected tab"
  );
  BrowserTestUtils.removeTab(other);
});

add_task(async function test_split_button() {
  const other = BrowserTestUtils.addTab(gBrowser, "about:blank");
  const button = other.querySelector(".tab-split-button");
  Assert.equal(
    await tooltipOf(button),
    "Add Split View...",
    "The split button describes itself rather than showing the tab title"
  );
  BrowserTestUtils.removeTab(other);
});
