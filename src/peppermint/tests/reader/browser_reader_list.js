/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { articleNoteMarkdown } = ChromeUtils.importESModule(
  "moz-src:///peppermint/reader/PeppermintReader.sys.mjs"
);

const BASE = "https://example.com/reading-list";
const MAX_TOTAL_PREF = "peppermint.reader.offline.max-total-bytes";

add_setup(async function () {
  await resetStore();
  registerCleanupFunction(async () => {
    Services.prefs.clearUserPref(MAX_TOTAL_PREF);
    await resetStore();
  });
});

function save(name, extra = {}) {
  return Store.saveArticle({
    url: `${BASE}/${name}`,
    title: name,
    content: `<p>${name} ${"text ".repeat(20)}</p>`,
    excerpt: `About ${name}`,
    ...extra,
  });
}

add_task(function test_tags_are_cleaned_up() {
  Assert.deepEqual(
    Store.normalizeTags(" Work, to read ,work,, "),
    ["work", "to read"],
    "tags are trimmed, lower cased and not repeated"
  );
  Assert.deepEqual(Store.normalizeTags([]), [], "no tags is fine");
  Assert.equal(
    Store.normalizeTags("a,b,c,d,e,f,g,h,i,j,k,l").length,
    10,
    "an article keeps at most ten"
  );
  Assert.equal(
    Store.normalizeTags("x".repeat(80))[0].length,
    32,
    "long tags are cut"
  );
});

add_task(function test_eviction_prefers_read_then_oldest() {
  const records = [
    { id: "a", bytes: 100, savedAt: 1, read: false },
    { id: "b", bytes: 100, savedAt: 2, read: true, readAt: 50 },
    { id: "c", bytes: 100, savedAt: 3, read: true, readAt: 40 },
    { id: "d", bytes: 100, savedAt: 4, read: false },
  ];
  Assert.deepEqual(Store.pickEvictions(records, 400), [], "under the limit");
  Assert.deepEqual(
    Store.pickEvictions(records, 300),
    ["c"],
    "the read article read longest ago goes first"
  );
  Assert.deepEqual(
    Store.pickEvictions(records, 100),
    ["c", "b", "a"],
    "then the other read one, then the oldest unread one"
  );
  Assert.deepEqual(
    Store.pickEvictions(records, 0, "c"),
    ["b", "a", "d"],
    "the article that was just saved is never chosen"
  );
});

add_task(async function test_read_state_and_tags_persist() {
  const record = await save("persist");
  Assert.ok(!record.read, "a new article is unread");
  Assert.deepEqual(record.tags, [], "and has no tags");

  Assert.ok(await Store.setRead(record.id, true), "it can be marked read");
  Assert.ok(await Store.setTags(record.id, "Work, later"), "and tagged");
  let stored = await Store.getRecord(record.id);
  Assert.ok(stored.read && stored.readAt > 0, "read state is stored");
  Assert.deepEqual(stored.tags, ["work", "later"], "tags are stored");

  await save("persist", { title: "persist (updated)" });
  stored = await Store.getRecord(record.id);
  Assert.equal(stored.title, "persist (updated)", "saving again refreshes it");
  Assert.ok(stored.read, "and keeps the read state");
  Assert.deepEqual(stored.tags, ["work", "later"], "and the tags");

  Assert.ok(await Store.setRead(record.id, false), "it can be unread again");
  Assert.equal((await Store.getRecord(record.id)).readAt, 0, "readAt resets");
  Assert.ok(
    !(await Store.setRead(`${BASE}/not-saved`, true)),
    "an article that is not saved cannot be updated"
  );
  await Store.clearArticles();
});

add_task(async function test_total_size_cap_evicts_old_articles() {
  const first = await save("cap-one");
  await save("cap-two");
  await Store.setRead(first.id, true);
  const bytes = await Store.totalBytes();
  Services.prefs.setIntPref(MAX_TOTAL_PREF, Math.floor(bytes * 1.2));

  await save("cap-three");
  const titles = (await Store.listArticles()).map(record => record.title);
  Assert.ok(titles.includes("cap-three"), "the new article is kept");
  Assert.ok(!titles.includes("cap-one"), "the read article made room");
  Assert.ok(titles.includes("cap-two"), "the unread one stays while it fits");
  Assert.ok(
    !(await Store.getArticle(first.id)),
    "the evicted article's file is gone too"
  );
  Services.prefs.clearUserPref(MAX_TOTAL_PREF);
  await Store.clearArticles();
});

add_task(function test_note_for_an_article() {
  const markdown = articleNoteMarkdown({
    title: "A title",
    url: "https://example.com/a",
    siteName: "Example",
    byline: "Someone",
    excerpt: "Line one\n  line two",
    tags: ["work", "later"],
  });
  Assert.ok(markdown.startsWith("# A title\n"), "the note opens with a heading");
  Assert.ok(
    markdown.includes("[Example](https://example.com/a)"),
    "it links to the article"
  );
  Assert.ok(markdown.includes("> Line one line two"), "it quotes the excerpt");
  Assert.ok(markdown.includes("#work #later"), "it lists the tags");
});

function pageState(browser) {
  return SpecialPowers.spawn(browser, [], () => ({
    titles: [...content.document.querySelectorAll(".saved-item-title")].map(
      node => node.textContent
    ),
    unread: [...content.document.querySelectorAll(".saved-item.unread")].length,
    filters: [...content.document.querySelectorAll(".saved-filter")].map(
      node => node.dataset.filter
    ),
  }));
}

function inPage(browser, selector, action) {
  return SpecialPowers.spawn(browser, [selector, action], (sel, act) => {
    const target = content.document.querySelector(sel);
    if (act === "click") {
      target.click();
    }
    return !!target;
  });
}

add_task(async function test_list_filters_and_actions() {
  const read = await save("page-read");
  await save("page-unread");
  await Store.setRead(read.id, true);
  await Store.setTags(read.id, "work");

  const tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "about:saved"
  );
  const browser = tab.linkedBrowser;
  await TestUtils.waitForCondition(
    async () => (await pageState(browser)).titles.length === 2,
    "both articles are listed"
  );
  let state = await pageState(browser);
  Assert.equal(state.unread, 1, "only the unread article is marked");
  Assert.deepEqual(
    state.filters,
    ["all", "unread", "tag:work"],
    "there are filters for all, unread and each tag"
  );

  await inPage(browser, '.saved-filter[data-filter="unread"]', "click");
  Assert.deepEqual(
    (await pageState(browser)).titles,
    ["page-unread"],
    "the Unread filter hides read articles"
  );
  await inPage(browser, '.saved-filter[data-filter="tag:work"]', "click");
  Assert.deepEqual(
    (await pageState(browser)).titles,
    ["page-read"],
    "a tag filter shows tagged articles"
  );
  await inPage(browser, '.saved-filter[data-filter="all"]', "click");

  // Marking the unread article as read from the list.
  await SpecialPowers.spawn(browser, [], () => {
    [...content.document.querySelectorAll(".saved-item")]
      .find(item => item.querySelector(".saved-item-title").textContent === "page-unread")
      .querySelector(".saved-toggle-read")
      .click();
  });
  await TestUtils.waitForCondition(
    async () => (await pageState(browser)).unread === 0,
    "the article is marked read from the list"
  );

  // Editing tags.
  await SpecialPowers.spawn(browser, [], () => {
    content.document.querySelector(".saved-edit-tags").click();
    const input = content.document.querySelector(".saved-tags-input");
    input.value = "Reading, Fun";
    input.dispatchEvent(
      new content.KeyboardEvent("keydown", { key: "Enter", bubbles: true })
    );
  });
  await TestUtils.waitForCondition(async () => {
    const records = await Store.listArticles();
    return records.some(record => record.tags.includes("fun"));
  }, "tags typed into the list are stored");

  // Sending an article to Notepad.
  const noteTab = BrowserTestUtils.waitForNewTab(gBrowser, null, true, true);
  await inPage(browser, ".saved-send-note", "click");
  const opened = await noteTab;
  await TestUtils.waitForCondition(
    () => opened.linkedBrowser.currentURI.spec.startsWith("mint://note/"),
    "the article opens as a note"
  );
  BrowserTestUtils.removeTab(opened);
  BrowserTestUtils.removeTab(tab);
  await Store.clearArticles();
});
