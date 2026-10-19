/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Firefox Sync engine for notes. A note travels as one record whose cleartext
 * (the markdown, the title and the page it is about) Sync encrypts with the
 * account's keys before upload, so the server never sees it. The copy on disk
 * stays encrypted with this device's own key.
 */

import {
  LegacyTracker,
  Store,
  SyncEngine,
} from "resource://services-sync/engines.sys.mjs";
import { CryptoWrapper } from "resource://services-sync/record.sys.mjs";
import { SCORE_INCREMENT_XLARGE } from "resource://services-sync/constants.sys.mjs";

import {
  NOTES_CHANGED_TOPIC,
  deleteNote,
  listNoteIds,
  loadNote,
  noteExists,
  noteFileSize,
  saveNote,
} from "resource:///modules/zen/notepad/ZenNotepadStore.sys.mjs";
import { isNoteId } from "resource:///modules/zen/notepad/ZenNotepadMarkdown.mjs";

// The server refuses records of about 256 KB. A note's file is its text,
// encrypted and encoded, which is about a third larger, and Sync adds its
// own encryption on top, so larger notes stay on the device that wrote them.
export const MAX_SYNCED_NOTE_FILE_BYTES = 150 * 1024;

export class PeppermintNotesRecord extends CryptoWrapper {
  _logName = "Sync.Record.Notes";
}

PeppermintNotesRecord.prototype.type = "note";

class PeppermintNotesStore extends Store {
  async getAllIDs() {
    const ids = {};
    for (const id of await listNoteIds()) {
      ids[id] = true;
    }
    return ids;
  }

  async itemExists(id) {
    return isNoteId(id) && (await noteExists(id));
  }

  async createRecord(id, collection) {
    const record = new PeppermintNotesRecord(collection, id);
    const note = isNoteId(id) ? await loadNote(id) : null;
    if (!note) {
      record.deleted = true;
      return record;
    }
    record.cleartext = {
      id,
      markdown: note.markdown,
      title: note.title,
      url: note.url,
    };
    return record;
  }

  async applyIncomingBatch(records, countTelemetry) {
    const failed = [];
    for (const record of records) {
      try {
        await this.#apply(record);
      } catch (error) {
        console.error("Notes sync could not apply a record", error);
        countTelemetry?.addIncomingFailedReason(`failed to apply ${record.id}`);
        failed.push(record.id);
      }
    }
    return failed;
  }

  async #apply(record) {
    if (!isNoteId(record.id)) {
      throw new Error("Not a note id");
    }
    if (record.deleted) {
      await deleteNote(record.id);
      return;
    }
    const { markdown, title, url } = record.cleartext;
    if (typeof markdown !== "string") {
      throw new Error("A note record without text");
    }
    await saveNote(record.id, markdown, title || null, { url: url || null });
  }

  async wipe() {
    // Turning sync off or resetting the server must never delete notes.
  }

  async changeItemID() {}
}

/**
 * Remembers which notes changed since the last sync. Changes Sync itself makes
 * while applying incoming records are ignored (ignoreAll), so they are not
 * uploaded again.
 */
class PeppermintNotesTracker extends LegacyTracker {
  onStart() {
    Services.obs.addObserver(this.asyncObserver, NOTES_CHANGED_TOPIC);
  }

  onStop() {
    Services.obs.removeObserver(this.asyncObserver, NOTES_CHANGED_TOPIC);
  }

  async observe(_subject, _topic, id) {
    if (this.ignoreAll || !isNoteId(id)) {
      return;
    }
    if (await this.addChangedID(id)) {
      this.score += SCORE_INCREMENT_XLARGE;
    }
  }
}

export class PeppermintNotesEngine extends SyncEngine {
  constructor(service) {
    super("Notes", service);
  }

  get _storeObj() {
    return PeppermintNotesStore;
  }

  get _trackerObj() {
    return PeppermintNotesTracker;
  }

  get _recordObj() {
    return PeppermintNotesRecord;
  }

  get version() {
    return 1;
  }

  get syncPriority() {
    return 7;
  }

  async getChangedIDs() {
    const changed = await super.getChangedIDs();
    // Notes too large for the server are left out instead of failing the
    // upload of the others. A deleted note has no file and is always sent.
    for (const id of Object.keys(changed)) {
      if ((await noteFileSize(id)) > MAX_SYNCED_NOTE_FILE_BYTES) {
        delete changed[id];
      }
    }
    return changed;
  }

  async pullAllChanges() {
    const changes = await super.pullAllChanges();
    for (const id of Object.keys(changes)) {
      if ((await noteFileSize(id)) > MAX_SYNCED_NOTE_FILE_BYTES) {
        delete changes[id];
      }
    }
    return changes;
  }

  /**
   * Notes the engine would upload: the changed ones, minus the oversized.
   * Tests use this to look at what a sync would send.
   *
   * @returns {Promise<string[]>}
   */
  async idsToUpload() {
    return Object.keys(await this.getChangedIDs());
  }
}
