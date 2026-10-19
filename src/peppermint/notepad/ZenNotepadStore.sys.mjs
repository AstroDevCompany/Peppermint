/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { OSKeyStore } from "resource://gre/modules/OSKeyStore.sys.mjs";

import {
  isNoteId,
  noteSummary,
} from "resource:///modules/zen/notepad/ZenNotepadMarkdown.mjs";

/** Notifies when a note is saved or deleted; the data is the note's id. */
export const NOTES_CHANGED_TOPIC = "peppermint-notepad-store-changed";

const KEY_FILE = "key.bin";
const NOTE_SUFFIX = ".note";

let keyPromise = null;
const inflightSaves = new Set();

function startAutoLock() {
  ChromeUtils.importESModule(
    "resource:///modules/zen/notepad/ZenNotepadLock.sys.mjs"
  ).ZenNotepadLock.start();
}

/**
 * Drop the unwrapped key. The next read or write authenticates again.
 */
export function lockNotes() {
  keyPromise = null;
}

/**
 * @returns {boolean} A key unwrap is cached in this process
 */
export function isKeyCached() {
  return !!keyPromise;
}

/**
 * @returns {number} Saves that have not finished writing yet
 */
export function pendingSaveCount() {
  return inflightSaves.size;
}

/**
 * @returns {Promise<void>} Resolves when every save started so far has settled
 */
export function waitForPendingSaves() {
  return Promise.allSettled([...inflightSaves]).then(() => {});
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function notesDirectory() {
  return PathUtils.join(PathUtils.profileDir, "notepad");
}

export function noteFilePath(id) {
  if (!isNoteId(id)) {
    throw new Error("Invalid note id");
  }
  return PathUtils.join(notesDirectory(), `${id.toLowerCase()}${NOTE_SUFFIX}`);
}

async function ensureDirectory() {
  await IOUtils.makeDirectory(notesDirectory());
}

async function unwrapKey() {
  await ensureDirectory();
  const keyPath = PathUtils.join(notesDirectory(), KEY_FILE);
  if (await IOUtils.exists(keyPath)) {
    const wrapped = await IOUtils.readUTF8(keyPath);
    const rawBase64 = await OSKeyStore.decrypt(wrapped, "zen-notepad");
    return crypto.subtle.importKey(
      "raw",
      base64ToBytes(rawBase64),
      "AES-GCM",
      false,
      ["encrypt", "decrypt"]
    );
  }
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const wrapped = await OSKeyStore.encrypt(bytesToBase64(raw));
  await IOUtils.writeUTF8(keyPath, wrapped);
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

function encryptionKey() {
  if (keyPromise) {
    return keyPromise;
  }
  // One shared promise so two first-run saves cannot each write key.bin.
  const promise = unwrapKey()
    .then(key => {
      startAutoLock();
      return key;
    })
    .catch(error => {
      if (keyPromise === promise) {
        keyPromise = null;
      }
      throw error;
    });
  keyPromise = promise;
  return promise;
}

function encodeNotePlaintext(markdown, title, url) {
  if (title || url) {
    return JSON.stringify({
      markdown,
      ...(title ? { title } : {}),
      ...(url ? { url } : {}),
    });
  }
  return markdown;
}

function decodeNotePlaintext(plain) {
  const decoded = new TextDecoder().decode(plain);
  try {
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed.markdown === "string") {
      return {
        markdown: parsed.markdown,
        title: typeof parsed.title === "string" ? parsed.title : null,
        url: typeof parsed.url === "string" ? parsed.url : null,
      };
    }
  } catch {
    // Older notes store raw markdown only.
  }
  return { markdown: decoded, title: null, url: null };
}

/**
 * @param {string} id
 * @param {string} markdown
 * @param {string|null} [title] - A title the user typed, if any
 * @param {{url?: string|null}} [meta] - The page the note is about. Left out
 *   (as the note page does), the note keeps the page it already has.
 * @returns {Promise<void>}
 */
export function saveNote(id, markdown, title = null, meta = undefined) {
  const job = writeEncryptedNote(id, markdown, title, meta).then(() => {
    Services.obs.notifyObservers(null, NOTES_CHANGED_TOPIC, id);
  });
  inflightSaves.add(job);
  return job.finally(() => inflightSaves.delete(job));
}

async function writeEncryptedNote(id, markdown, title = null, meta = undefined) {
  const path = noteFilePath(id);
  const key = await encryptionKey();
  let url = meta?.url ?? null;
  if (meta === undefined) {
    // Keep the page the note is about; a note that cannot be read just loses it.
    url = await loadNote(id)
      .then(existing => existing?.url ?? null)
      .catch(() => null);
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(encodeNotePlaintext(markdown, title, url))
  );
  const payload = JSON.stringify({
    v: 1,
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(cipher)),
  });
  await IOUtils.writeUTF8(path, payload);
}

export async function loadNote(id) {
  const path = noteFilePath(id);
  if (!(await IOUtils.exists(path))) {
    return null;
  }
  const payload = JSON.parse(await IOUtils.readUTF8(path));
  const key = await encryptionKey();
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(payload.iv) },
    key,
    base64ToBytes(payload.data)
  );
  return decodeNotePlaintext(plain);
}

/**
 * Lists every note with what a list shows about it. Notes are encrypted, so
 * this opens each one; it is meant for the notes page, not for hot paths.
 *
 * @returns {Promise<{id: string, title: string, excerpt: string,
 *   url: string|null, updatedAt: number}[]>} Most recently changed first
 */
export async function listNotes() {
  if (!(await IOUtils.exists(notesDirectory()))) {
    return [];
  }
  const notes = [];
  for (const path of await IOUtils.getChildren(notesDirectory())) {
    if (!path.endsWith(NOTE_SUFFIX)) {
      continue;
    }
    const id = PathUtils.filename(path).slice(0, -NOTE_SUFFIX.length);
    if (!isNoteId(id)) {
      continue;
    }
    try {
      const [note, info] = await Promise.all([loadNote(id), IOUtils.stat(path)]);
      if (!note) {
        continue;
      }
      const { title, excerpt } = noteSummary(note.markdown, note.title);
      notes.push({
        id,
        title,
        excerpt,
        url: note.url,
        updatedAt: info.lastModified,
      });
    } catch (error) {
      console.error("Notepad could not read a note for the list", error);
    }
  }
  return notes.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * @returns {Promise<string[]>} The ids of all notes, without opening them
 */
export async function listNoteIds() {
  if (!(await IOUtils.exists(notesDirectory()))) {
    return [];
  }
  const ids = [];
  for (const path of await IOUtils.getChildren(notesDirectory())) {
    if (path.endsWith(NOTE_SUFFIX)) {
      const id = PathUtils.filename(path).slice(0, -NOTE_SUFFIX.length);
      if (isNoteId(id)) {
        ids.push(id);
      }
    }
  }
  return ids;
}

/**
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export function noteExists(id) {
  return IOUtils.exists(noteFilePath(id));
}

/**
 * @param {string} id
 * @returns {Promise<number>} Bytes the encrypted note takes on disk, 0 if absent
 */
export async function noteFileSize(id) {
  try {
    return (await IOUtils.stat(noteFilePath(id))).size;
  } catch {
    return 0;
  }
}

/**
 * @param {string} url - Address of a page
 * @returns {Promise<string|null>} The id of the note about that page, if any
 */
export async function findNoteIdForUrl(url) {
  const notes = await listNotes();
  return notes.find(note => note.url === url)?.id ?? null;
}

/**
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteNote(id) {
  await IOUtils.remove(noteFilePath(id), { ignoreAbsent: true });
  Services.obs.notifyObservers(null, NOTES_CHANGED_TOPIC, id);
}

export async function writePlainMarkdown(path, markdown) {
  await IOUtils.writeUTF8(path, markdown);
}
