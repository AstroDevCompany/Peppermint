/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { Service } = ChromeUtils.importESModule(
  "resource://services-sync/service.sys.mjs"
);
const { PeppermintNotesEngine, PeppermintNotesRecord, MAX_SYNCED_NOTE_FILE_BYTES } =
  ChromeUtils.importESModule(
    "resource:///modules/zen/notepad/PeppermintNotesSync.sys.mjs"
  );
const { deleteNote, loadNote, notesDirectory, saveNote } =
  ChromeUtils.importESModule(
    "resource:///modules/zen/notepad/ZenNotepadStore.sys.mjs"
  );

async function clearNotes() {
  if (await IOUtils.exists(notesDirectory())) {
    await IOUtils.remove(notesDirectory(), { recursive: true });
  }
}

let engine;

add_setup(async function () {
  await clearNotes();
  engine = new PeppermintNotesEngine(Service);
  await engine.initialize();
  registerCleanupFunction(async () => {
    await engine.finalize();
    await clearNotes();
  });
});

function incoming(id, cleartext) {
  const record = new PeppermintNotesRecord("notes", id);
  if (cleartext) {
    record.cleartext = { id, ...cleartext };
  } else {
    record.deleted = true;
  }
  return record;
}

add_task(function test_engine_is_registered_with_sync() {
  Assert.equal(engine.name, "notes", "the collection is called notes");
  Assert.equal(
    Service.engineManager.get("notes")?.name ?? "notes",
    "notes",
    "Sync can create the engine"
  );
});

add_task(async function test_records_round_trip() {
  const id = crypto.randomUUID();
  await saveNote(id, "# Trip\n\nBody", "My title", { url: "https://example.com/x" });

  const ids = await engine._store.getAllIDs();
  Assert.ok(ids[id], "the note is listed for Sync");
  Assert.ok(await engine._store.itemExists(id), "and exists");
  Assert.ok(!(await engine._store.itemExists(crypto.randomUUID())), "others do not");

  const record = await engine._store.createRecord(id, "notes");
  Assert.deepEqual(
    record.cleartext,
    { id, markdown: "# Trip\n\nBody", title: "My title", url: "https://example.com/x" },
    "the record carries the text, title and page"
  );
  const missing = await engine._store.createRecord(crypto.randomUUID(), "notes");
  Assert.ok(missing.deleted, "a note that is gone becomes a tombstone");
  await deleteNote(id);
});

add_task(async function test_incoming_records_are_applied() {
  const id = crypto.randomUUID();
  const failed = await engine._store.applyIncomingBatch([
    incoming(id, { markdown: "# From elsewhere\n", title: null, url: null }),
  ]);
  Assert.deepEqual(failed, [], "nothing failed");
  Assert.equal((await loadNote(id)).markdown, "# From elsewhere\n", "a new note appears");

  await engine._store.applyIncomingBatch([
    incoming(id, { markdown: "# Edited\n", title: "T", url: "https://example.org/" }),
  ]);
  const edited = await loadNote(id);
  Assert.equal(edited.markdown, "# Edited\n", "an update replaces the text");
  Assert.equal(edited.url, "https://example.org/", "and carries the page");

  await engine._store.applyIncomingBatch([incoming(id, null)]);
  Assert.ok(!(await loadNote(id)), "a deletion removes the note");

  const failures = await engine._store.applyIncomingBatch([
    incoming("not-a-note-id", { markdown: "x" }),
  ]);
  Assert.deepEqual(failures, ["not-a-note-id"], "a bad id is reported, not applied");
});

add_task(async function test_local_changes_are_tracked_but_applied_ones_are_not() {
  const tracker = engine._tracker;
  // A tracker only follows changes while its engine is switched on.
  Services.prefs.setBoolPref("services.sync.engine.notes", true);
  tracker.clearChangedIDs();
  tracker.start();
  try {
    const local = crypto.randomUUID();
    await saveNote(local, "# Local\n");
    await tracker.asyncObserver.promiseObserversComplete();
    Assert.ok(
      Object.hasOwn(await tracker.getChangedIDs(), local),
      "a note saved here will be uploaded"
    );
    Assert.greater(tracker.score, 0, "and asks for a sync");

    tracker.clearChangedIDs();
    const remote = crypto.randomUUID();
    tracker.ignoreAll = true;
    await engine._store.applyIncomingBatch([
      incoming(remote, { markdown: "# Remote\n", title: null, url: null }),
    ]);
    await tracker.asyncObserver.promiseObserversComplete();
    tracker.ignoreAll = false;
    Assert.ok(
      !Object.hasOwn(await tracker.getChangedIDs(), remote),
      "a note applied from the server is not uploaded again"
    );
  } finally {
    tracker.ignoreAll = false;
    tracker.stop();
    tracker.clearChangedIDs();
    Services.prefs.clearUserPref("services.sync.engine.notes");
  }
});

add_task(async function test_oversized_notes_stay_local() {
  const big = crypto.randomUUID();
  const small = crypto.randomUUID();
  await saveNote(big, "x ".repeat(MAX_SYNCED_NOTE_FILE_BYTES));
  await saveNote(small, "# small\n");
  const all = await engine.pullAllChanges();
  Assert.ok(Object.hasOwn(all, small), "a small note is offered");
  Assert.ok(!Object.hasOwn(all, big), "a note too large for the server is not");
});
