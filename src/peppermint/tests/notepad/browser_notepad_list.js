/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { noteSummary } = ChromeUtils.importESModule(
  "resource:///modules/zen/notepad/ZenNotepadMarkdown.mjs"
);
const {
  NOTES_CHANGED_TOPIC,
  deleteNote,
  findNoteIdForUrl,
  listNotes,
  loadNote,
  notesDirectory,
  saveNote,
} = ChromeUtils.importESModule(
  "resource:///modules/zen/notepad/ZenNotepadStore.sys.mjs"
);

const PAGE = "https://example.com/some/page";

async function clearNotes() {
  if (await IOUtils.exists(notesDirectory())) {
    await IOUtils.remove(notesDirectory(), { recursive: true });
  }
}

add_setup(async function () {
  await clearNotes();
  registerCleanupFunction(clearNotes);
});

add_task(function test_summary() {
  Assert.deepEqual(
    noteSummary("# Shopping\n\nMilk and **eggs**\n\n- bread"),
    { title: "Shopping", excerpt: "Milk and eggs bread" },
    "the first line is the title and the rest is the excerpt"
  );
  Assert.deepEqual(
    noteSummary("First line\nSecond line", "My title"),
    { title: "My title", excerpt: "First line Second line" },
    "a title the user typed leaves the first line in the excerpt"
  );
  Assert.deepEqual(
    noteSummary(""),
    { title: "", excerpt: "" },
    "an empty note has neither"
  );
  Assert.lessOrEqual(
    noteSummary("# T\n\n" + "word ".repeat(200)).excerpt.length,
    200,
    "the excerpt is short"
  );
});

add_task(async function test_list_find_and_delete() {
  const plainId = crypto.randomUUID();
  const pageId = crypto.randomUUID();
  await saveNote(plainId, "# Plain note\n\nSome body");
  await saveNote(pageId, "# About a page\n\nBody", null, { url: PAGE });

  let changes = 0;
  const observer = { observe: () => changes++ };
  Services.obs.addObserver(observer, NOTES_CHANGED_TOPIC);

  const notes = await listNotes();
  Assert.equal(notes.length, 2, "both notes are listed");
  Assert.equal(notes[0].id, pageId, "the one saved last comes first");
  Assert.equal(notes[0].url, PAGE, "its page is kept");
  Assert.equal(notes[1].url, null, "the other has no page");
  Assert.equal(notes[1].title, "Plain note", "titles come from the text");

  await saveNote(pageId, "# About a page\n\nEdited");
  Assert.equal(
    (await loadNote(pageId)).url,
    PAGE,
    "saving without a page (as the note page does) keeps the page"
  );
  Assert.equal(await findNoteIdForUrl(PAGE), pageId, "the note is found by page");
  Assert.equal(await findNoteIdForUrl(`${PAGE}/other`), null, "other pages have none");

  await deleteNote(plainId);
  Assert.equal((await listNotes()).length, 1, "a deleted note leaves the list");
  Assert.ok(!(await loadNote(plainId)), "and cannot be loaded");
  Assert.greaterOrEqual(changes, 2, "saves and deletes are announced");
  Services.obs.removeObserver(observer, NOTES_CHANGED_TOPIC);
  await clearNotes();
});

function listed(browser) {
  return SpecialPowers.spawn(browser, [], () =>
    [...content.document.querySelectorAll(".notes-item-title")].map(
      node => node.textContent
    )
  );
}

add_task(async function test_notes_page() {
  await saveNote(crypto.randomUUID(), "# Alpha note\n\nabout apples");
  await saveNote(crypto.randomUUID(), "# Beta note\n\nabout bananas", null, {
    url: PAGE,
  });
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, "about:notes");
  const browser = tab.linkedBrowser;
  try {
    await TestUtils.waitForCondition(
      async () => (await listed(browser)).length === 2,
      "both notes are listed"
    );
    Assert.deepEqual(
      (await listed(browser)).sort(),
      ["Alpha note", "Beta note"],
      "titles are shown"
    );
    const pageChip = await SpecialPowers.spawn(browser, [], () =>
      content.document.querySelectorAll(".notes-item-page").length
    );
    Assert.equal(pageChip, 1, "a note about a page says which site");

    await SpecialPowers.spawn(browser, [], () => {
      const search = content.document.getElementById("notes-search");
      search.value = "banana";
      search.dispatchEvent(new content.Event("input", { bubbles: true }));
    });
    Assert.deepEqual(await listed(browser), ["Beta note"], "search filters the list");
    await SpecialPowers.spawn(browser, [], () => {
      const search = content.document.getElementById("notes-search");
      search.value = "";
      search.dispatchEvent(new content.Event("input", { bubbles: true }));
    });

    // Deleting asks twice.
    const clickDelete = () =>
      SpecialPowers.spawn(browser, [], () => {
        [...content.document.querySelectorAll(".notes-item")]
          .find(item => item.querySelector(".notes-item-title").textContent === "Alpha note")
          .querySelector(".notes-delete")
          .click();
      });
    await clickDelete();
    Assert.equal((await listNotes()).length, 2, "the first click only asks");
    await clickDelete();
    await TestUtils.waitForCondition(
      async () => (await listNotes()).length === 1,
      "the second click deletes"
    );
    await TestUtils.waitForCondition(
      async () => (await listed(browser)).length === 1,
      "the list follows"
    );

    // New note opens the editor in this tab.
    const loaded = BrowserTestUtils.browserLoaded(browser, false, uri =>
      uri.startsWith("mint://note/")
    );
    await SpecialPowers.spawn(browser, [], () => {
      content.document.getElementById("notes-new").click();
    });
    await loaded;
    Assert.ok(
      browser.currentURI.spec.startsWith("mint://note/"),
      "New note opens a blank note"
    );
  } finally {
    BrowserTestUtils.removeTab(tab);
    await clearNotes();
  }
});
