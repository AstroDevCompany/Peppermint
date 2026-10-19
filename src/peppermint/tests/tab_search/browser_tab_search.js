/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

ChromeUtils.defineESModuleGetters(this, {
  UrlbarShared: "chrome://browser/content/urlbar/UrlbarShared.mjs",
  UrlbarTestUtils: "resource://testing-common/UrlbarTestUtils.sys.mjs",
  openTabSearch:
    "moz-src:///peppermint/urlbar/PeppermintUrlbarProviderTabSearch.sys.mjs",
  rankTabs:
    "moz-src:///peppermint/urlbar/PeppermintUrlbarProviderTabSearch.sys.mjs",
  scoreTab:
    "moz-src:///peppermint/urlbar/PeppermintUrlbarProviderTabSearch.sys.mjs",
});

const PROVIDER = "PeppermintUrlbarProviderTabSearch";

add_task(function test_scoring() {
  const tab = {
    title: "Pull requests - GitHub",
    url: "https://github.com/pulls",
    space: "Work",
  };
  Assert.greater(scoreTab(["github"], tab), 0, "a word in the title matches");
  Assert.greater(scoreTab(["pulls"], tab), 0, "a word in the address matches");
  Assert.greater(scoreTab(["work"], tab), 0, "the space name matches");
  Assert.greater(scoreTab(["gthb"], tab), 0, "letters in order match loosely");
  Assert.greater(scoreTab(["hu"], tab), 0, "short words match inside words");
  Assert.equal(
    scoreTab(["gb"], { title: "gab", url: "https://x.test/" }),
    0,
    "short words are never matched as scattered letters"
  );
  Assert.equal(scoreTab(["xyz"], tab), 0, "an unrelated word does not match");
  Assert.equal(
    scoreTab(["github", "xyz"], tab),
    0,
    "every word has to match"
  );
  Assert.greater(
    scoreTab(["pull"], tab),
    scoreTab(["ull"], tab),
    "the start of a word beats the middle of one"
  );
  Assert.greater(
    scoreTab(["github"], { title: "GitHub", url: "https://x.test/" }),
    scoreTab(["github"], { title: "Home", url: "https://github.com/" }),
    "a title match beats an address match"
  );
});

add_task(function test_ranking() {
  const tabs = [
    { title: "Old docs", url: "https://a.test/", lastAccessed: 1 },
    { title: "New docs", url: "https://b.test/", lastAccessed: 3 },
    { title: "Other", url: "https://c.test/", lastAccessed: 2 },
  ];
  Assert.deepEqual(
    rankTabs([], tabs).map(tab => tab.title),
    ["New docs", "Other", "Old docs"],
    "an empty query lists the most recently used first"
  );
  Assert.deepEqual(
    rankTabs(["docs"], tabs).map(tab => tab.title),
    ["New docs", "Old docs"],
    "equal matches are ordered by recency and misses are dropped"
  );
});

async function tabSearchResults(value) {
  await UrlbarTestUtils.promiseAutocompleteResultPopup({
    window,
    waitForFocus,
    value,
  });
  const results = [];
  for (let i = 0; i < UrlbarTestUtils.getResultCount(window); i++) {
    const { result } = await UrlbarTestUtils.getDetailsOfResultAt(window, i);
    results.push(result);
  }
  return results;
}

add_task(async function test_percent_searches_tabs() {
  const com = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "https://example.com/"
  );
  const org = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "https://example.org/"
  );
  const current = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "https://example.net/"
  );
  try {
    const results = await tabSearchResults("% org");
    Assert.equal(
      gURLBar.searchMode?.source,
      UrlbarShared.RESULT_SOURCE.TABS,
      "% enters tab search mode"
    );
    Assert.ok(
      results.length && results.every(r => r.providerName == PROVIDER),
      "only the tab search provider answers in this mode"
    );
    Assert.deepEqual(
      results.map(r => r.payload.url),
      ["https://example.org/"],
      "the matching tab is listed and the others are not"
    );
    Assert.equal(
      results[0].type,
      UrlbarShared.RESULT_TYPE.TAB_SWITCH,
      "the result switches to the tab"
    );
    await UrlbarTestUtils.promisePopupClose(window);
    gURLBar.searchMode = null;

    const everything = await tabSearchResults("% example");
    const urls = everything.map(r => r.payload.url);
    Assert.ok(
      !urls.includes("https://example.net/"),
      "the tab being shown is not offered"
    );
    Assert.equal(urls[0], "https://example.org/", "recent tabs come first");
    Assert.ok(urls.includes("https://example.com/"), "older tabs follow");
    await UrlbarTestUtils.promisePopupClose(window);
    gURLBar.searchMode = null;
  } finally {
    for (const tab of [com, org, current]) {
      BrowserTestUtils.removeTab(tab);
    }
  }
});

add_task(async function test_search_tabs_action_enters_the_mode() {
  const other = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "https://example.org/"
  );
  const current = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "https://example.net/"
  );
  try {
    openTabSearch(window);
    await TestUtils.waitForCondition(
      () => gURLBar.searchMode?.source,
      "search mode is applied"
    );
    await UrlbarTestUtils.promiseSearchComplete(window);
    Assert.equal(
      gURLBar.searchMode?.source,
      UrlbarShared.RESULT_SOURCE.TABS,
      "the Search Tabs command enters tab search mode"
    );
    const urls = [];
    for (let i = 0; i < UrlbarTestUtils.getResultCount(window); i++) {
      const { result } = await UrlbarTestUtils.getDetailsOfResultAt(window, i);
      urls.push(result.payload.url);
    }
    Assert.ok(
      urls.includes("https://example.org/"),
      "an empty query lists the other tabs"
    );
    await UrlbarTestUtils.promisePopupClose(window);
    gURLBar.searchMode = null;
  } finally {
    BrowserTestUtils.removeTab(current);
    BrowserTestUtils.removeTab(other);
  }
});
