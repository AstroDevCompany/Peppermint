/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * about:notes: lists the notes, and opens, searches and deletes them.
 */

const { NOTES_CHANGED_TOPIC, deleteNote, listNotes } =
  ChromeUtils.importESModule(
    "resource:///modules/zen/notepad/ZenNotepadStore.sys.mjs"
  );
const { noteURL } = ChromeUtils.importESModule(
  "resource:///modules/zen/notepad/ZenNotepadMarkdown.mjs"
);

// Long enough to read the new label and decide; leaving the button also cancels.
const CONFIRM_RESET_MS = 6000;

const list = document.getElementById("notes-list");
const search = document.getElementById("notes-search");
const newButton = document.getElementById("notes-new");
const emptyState = document.getElementById("notes-empty");
const noResults = document.getElementById("notes-no-results");
const errorNote = document.getElementById("notes-error");

const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

let notes = [];
// Id of the note whose delete button is waiting for a second click.
let confirming = null;
let confirmTimer = null;

function hostOf(spec) {
  return URL.parse(spec)?.host.replace(/^www\./, "") ?? spec;
}

function buildRow(note) {
  const item = document.createElement("li");
  item.className = "notes-item";
  item.dataset.id = note.id;

  const link = document.createElement("a");
  link.className = "notes-link";
  link.href = noteURL(note.id);

  const title = document.createElement("span");
  title.className = "notes-item-title";
  if (note.title) {
    title.textContent = note.title;
  } else {
    document.l10n.setAttributes(title, "peppermint-notes-untitled");
  }
  link.append(title);

  const meta = document.createElement("span");
  meta.className = "notes-item-meta";
  const updated = document.createElement("span");
  document.l10n.setAttributes(updated, "peppermint-notes-updated", {
    date: dateFormat.format(note.updatedAt),
  });
  meta.append(updated);
  if (note.url) {
    const page = document.createElement("span");
    page.className = "notes-item-page";
    document.l10n.setAttributes(page, "peppermint-notes-about-page", {
      site: hostOf(note.url),
    });
    meta.append(page);
  }
  link.append(meta);

  if (note.excerpt) {
    const excerpt = document.createElement("span");
    excerpt.className = "notes-item-excerpt";
    excerpt.textContent = note.excerpt;
    link.append(excerpt);
  }

  const actions = document.createElement("span");
  actions.className = "notes-item-actions";
  const open = document.createElement("button");
  open.type = "button";
  open.className = "notes-button notes-open-tab";
  document.l10n.setAttributes(open, "peppermint-notes-open-new-tab");
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "notes-button notes-delete";
  const isConfirming = confirming === note.id;
  remove.classList.toggle("confirming", isConfirming);
  remove.setAttribute("aria-live", "polite");
  document.l10n.setAttributes(
    remove,
    isConfirming ? "peppermint-notes-delete-confirm" : "peppermint-notes-delete"
  );
  actions.append(open, remove);

  item.append(link, actions);
  return item;
}

function matches(note, query) {
  return [note.title, note.excerpt, note.url ?? ""]
    .join("\n")
    .toLowerCase()
    .includes(query);
}

function render() {
  const query = search.value.trim().toLowerCase();
  const visible = query ? notes.filter(note => matches(note, query)) : notes;
  list.replaceChildren(...visible.map(buildRow));
  emptyState.hidden = !!notes.length;
  noResults.hidden = !notes.length || !!visible.length;
  search.hidden = !notes.length;
}

async function load() {
  try {
    notes = await listNotes();
    errorNote.hidden = true;
  } catch (error) {
    console.error("Notes: the list could not be read", error);
    notes = [];
    errorNote.hidden = false;
  }
  render();
}

function resetConfirm() {
  clearTimeout(confirmTimer);
  confirmTimer = null;
  confirming = null;
  render();
}

function openNote(id, where) {
  const win = window.browsingContext.topChromeWindow;
  win.openTrustedLinkIn(noteURL(id), where);
}

list.addEventListener("click", event => {
  const item = event.target.closest(".notes-item");
  if (!item) {
    return;
  }
  const id = item.dataset.id;
  if (event.target.closest(".notes-delete")) {
    if (confirming !== id) {
      confirming = id;
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(resetConfirm, CONFIRM_RESET_MS);
      render();
      item.parentElement
        ?.querySelector(`[data-id="${id}"] .notes-delete`)
        ?.focus();
      return;
    }
    clearTimeout(confirmTimer);
    confirming = null;
    deleteNote(id);
  } else if (event.target.closest(".notes-open-tab")) {
    openNote(id, "tab");
  } else if (event.target.closest(".notes-link")) {
    event.preventDefault();
    openNote(id, event.ctrlKey || event.metaKey ? "tab" : "current");
  }
});

// Moving focus off the delete button abandons the confirmation.
list.addEventListener("focusout", event => {
  if (confirming && event.target.closest(".notes-delete")) {
    resetConfirm();
  }
});

list.addEventListener("auxclick", event => {
  const item = event.target.closest(".notes-item");
  if (item && event.button === 1 && event.target.closest(".notes-link")) {
    event.preventDefault();
    openNote(item.dataset.id, "tab");
  }
});

newButton.addEventListener("click", () => {
  openNote(crypto.randomUUID(), "current");
});

search.addEventListener("input", render);

// A note saved or deleted anywhere, including in another window, changes the list.
const observer = { observe: () => load() };
Services.obs.addObserver(observer, NOTES_CHANGED_TOPIC);
window.addEventListener(
  "unload",
  () => Services.obs.removeObserver(observer, NOTES_CHANGED_TOPIC),
  { once: true }
);

load();
