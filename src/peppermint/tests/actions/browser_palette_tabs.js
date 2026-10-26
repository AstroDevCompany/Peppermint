/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { registerPeppermintActions, peppermintActions } =
  ChromeUtils.importESModule(
    "moz-src:///peppermint/common/PeppermintActions.sys.mjs"
  );
const { urlKey, markdownLink, markdownList, pickDuplicates } =
  ChromeUtils.importESModule(
    "moz-src:///peppermint/palette/PeppermintPaletteTabs.sys.mjs"
  );

const PAGE_A = "https://example.com/a";
const PAGE_B = "https://example.com/b";

function byId(id) {
  return peppermintActions().find(action => action.commandId === id);
}

add_task(function test_tab_and_dev_actions_have_labels() {
  registerPeppermintActions();
  const ids = [
    "close-duplicate-tabs",
    "close-other-tabs",
    "close-tabs-below",
    "copy-tab-urls",
    "copy-tabs-markdown",
    "copy-page-markdown-link",
    "copy-page-title",
    "toggle-responsive-design",
    "open-web-console",
    "view-page-source",
    "toggle-disable-cache",
  ];
  for (const id of ids) {
    const entry = byId(`peppermint:${id}`);
    ok(entry, `${id} exists`);
    ok(entry.label.length, `${id} has a label`);
    ok(!entry.label.includes("peppermint-"), `${id} label is translated`);
  }
});

add_task(function test_url_key_ignores_the_fragment() {
  Assert.equal(urlKey("https://a.test/x#top"), "https://a.test/x");
  Assert.equal(urlKey("https://a.test/x"), "https://a.test/x");
});

add_task(function test_markdown_helpers() {
  Assert.equal(
    markdownLink("A [b]\n c", "https://a.test/(x) y"),
    "[A \\[b\\] c](https://a.test/%28x%29%20y)"
  );
  Assert.equal(
    markdownLink("", "https://a.test/"),
    "[https://a.test/](https://a.test/)"
  );
  Assert.equal(
    markdownList([
      { title: "One", url: "https://one.test/" },
      { title: "Two", url: "https://two.test/" },
    ]),
    "- [One](https://one.test/)\n- [Two](https://two.test/)"
  );
});

add_task(function test_pick_duplicates_keeps_selected_or_latest() {
  const [t1, t2, t3, t4, t5] = [{}, {}, {}, {}, {}];
  const entries = [
    { tab: t1, url: PAGE_A, lastAccessed: 5 },
    { tab: t2, url: `${PAGE_A}#section`, lastAccessed: 9 },
    { tab: t3, url: PAGE_B, lastAccessed: 1 },
    { tab: t4, url: PAGE_B, lastAccessed: 2 },
    { tab: t5, url: "about:blank", lastAccessed: 3 },
  ];
  Assert.deepEqual(
    pickDuplicates(entries, t3),
    [t1, t4],
    "The selected one stays, the older of the others goes"
  );
  Assert.deepEqual(
    pickDuplicates(entries, t5),
    [t1, t3],
    "The most recently used one stays"
  );
  Assert.deepEqual(
    pickDuplicates(
      [
        { tab: {}, url: "about:blank" },
        { tab: {}, url: "about:blank" },
      ],
      null
    ),
    [],
    "Blank pages are left alone"
  );
});

add_task(async function test_close_duplicate_tabs() {
  const first = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE_A);
  const second = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    `${PAGE_A}#again`
  );
  const other = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE_B);
  const closeDuplicates = byId("peppermint:close-duplicate-tabs");
  try {
    ok(closeDuplicates.isAvailable(window), "Duplicates are offered");
    const closed = BrowserTestUtils.waitForEvent(first, "TabClose");
    closeDuplicates.command(window);
    await closed;
    ok(!first.isConnected, "The tab used least recently is closed");
    ok(second.isConnected, "The tab used most recently stays");
    ok(other.isConnected, "A different page stays");
    ok(!closeDuplicates.isAvailable(window), "Nothing left to close");
  } finally {
    for (const tab of [first, second, other]) {
      if (tab.isConnected) {
        BrowserTestUtils.removeTab(tab);
      }
    }
  }
});

function readClipboardText() {
  const transferable = Cc["@mozilla.org/widget/transferable;1"].createInstance(
    Ci.nsITransferable
  );
  transferable.init(null);
  transferable.addDataFlavor("text/plain");
  Services.clipboard.getData(transferable, Ci.nsIClipboard.kGlobalClipboard);
  const data = {};
  transferable.getTransferData("text/plain", data);
  return data.value.QueryInterface(Ci.nsISupportsString).data;
}

add_task(async function test_copy_actions() {
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE_A);
  try {
    const link = byId("peppermint:copy-page-markdown-link");
    ok(link.isAvailable(window), "Copying the link is offered on a web page");
    link.command(window);
    Assert.equal(
      readClipboardText(),
      markdownLink(gBrowser.selectedTab.label, PAGE_A),
      "The page was copied as a Markdown link"
    );
    byId("peppermint:copy-tab-urls").command(window);
    ok(
      readClipboardText().split("\n").includes(PAGE_A),
      "The address of the tab is among the copied addresses"
    );
  } finally {
    BrowserTestUtils.removeTab(tab);
  }
});

add_task(function test_disable_cache_toggles_its_pref() {
  const entry = byId("peppermint:toggle-disable-cache");
  const before = Services.prefs.getBoolPref("devtools.cache.disabled", false);
  try {
    entry.command(window);
    Assert.equal(
      Services.prefs.getBoolPref("devtools.cache.disabled"),
      !before,
      "The pref flipped"
    );
  } finally {
    Services.prefs.setBoolPref("devtools.cache.disabled", before);
  }
});
