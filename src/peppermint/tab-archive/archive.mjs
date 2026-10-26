/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * about:archive: lists the tabs that were archived or snoozed, and restores,
 * searches and removes them.
 */

const { STORE_CHANGED_TOPIC, clearRecords, listRecords, removeRecord } =
  ChromeUtils.importESModule(
    "moz-src:///peppermint/tab-archive/PeppermintTabArchiveStore.sys.mjs"
  );
const { PREF_HOURS, restoreRecord } = ChromeUtils.importESModule(
  "moz-src:///peppermint/tab-archive/PeppermintTabArchive.sys.mjs"
);
const { PrivateBrowsingUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/PrivateBrowsingUtils.sys.mjs"
);

// Long enough to read the new label and decide; leaving the button also cancels.
const CONFIRM_RESET_MS = 6000;
const ICON_PATH = "chrome://browser/skin/zen-icons/";
const DAY_MS = 24 * 60 * 60 * 1000;

const groups = document.getElementById("archive-list");
const tabs = document.getElementById("archive-tabs");
const search = document.getElementById("archive-search");
const clearButton = document.getElementById("archive-clear");
const emptyState = document.getElementById("archive-empty");
const emptyDescription = document.getElementById("archive-empty-description");
const noResults = document.getElementById("archive-no-results");
const privateNote = document.getElementById("archive-private");
const errorNote = document.getElementById("archive-error");

const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const dayFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "full" });

let records = [];
let kind = "archive";
let confirmTimer = null;

const isPrivate = PrivateBrowsingUtils.isWindowPrivate(
  window.browsingContext.topChromeWindow
);

function hostOf(spec) {
  return URL.parse(spec)?.host.replace(/^www\./, "") ?? spec;
}

function startOfDay(time) {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function iconButton(className, icon, l10nId) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `archive-icon-button ${className}`;
  document.l10n.setAttributes(button, l10nId);
  const image = document.createElement("img");
  image.src = `${ICON_PATH}${icon}`;
  image.alt = "";
  button.append(image);
  return button;
}

function buildRow(record) {
  const item = document.createElement("li");
  item.className = "archive-item";
  item.dataset.id = record.id;

  const link = document.createElement("a");
  link.className = "archive-link";
  link.href = record.url;

  const icon = document.createElement("img");
  icon.className = "archive-item-icon";
  icon.src = `page-icon:${record.url}`;
  icon.alt = "";

  const text = document.createElement("span");
  text.className = "archive-item-text";
  const title = document.createElement("span");
  title.className = "archive-item-title";
  title.textContent = record.title || record.url;
  const meta = document.createElement("span");
  meta.className = "archive-item-meta";
  const site = document.createElement("span");
  site.textContent = hostOf(record.url);
  const space = document.createElement("span");
  if (record.workspaceName) {
    document.l10n.setAttributes(space, "peppermint-archive-space", {
      space: record.workspaceName,
    });
  } else {
    document.l10n.setAttributes(space, "peppermint-archive-no-space");
  }
  const when = document.createElement("span");
  if (record.kind == "snooze") {
    document.l10n.setAttributes(when, "peppermint-archive-wakes-on", {
      date: dateFormat.format(record.wakeAt),
    });
  } else {
    document.l10n.setAttributes(when, "peppermint-archive-archived-on", {
      date: dateFormat.format(record.archivedAt),
    });
  }
  meta.append(site, space, when);
  text.append(title, meta);
  link.append(icon, text);

  const actions = document.createElement("span");
  actions.className = "archive-item-actions";
  actions.append(
    iconButton(
      "archive-restore",
      "arrow-rotate-anticlockwise.svg",
      "peppermint-archive-restore-button"
    ),
    iconButton(
      "archive-remove",
      "trash.svg",
      "peppermint-archive-remove-button"
    )
  );
  item.append(link, actions);
  return item;
}

function dayTitle(day, today) {
  const title = document.createElement("h2");
  title.className = "archive-group-title";
  if (day === today) {
    document.l10n.setAttributes(title, "peppermint-archive-group-today");
  } else if (day === today - DAY_MS) {
    document.l10n.setAttributes(title, "peppermint-archive-group-yesterday");
  } else {
    title.textContent = dayFormat.format(day);
  }
  return title;
}

function buildGroups(visible) {
  if (kind == "snooze") {
    const list = document.createElement("ul");
    list.className = "archive-list";
    list.append(...visible.map(buildRow));
    return [list];
  }
  const today = startOfDay(Date.now());
  const byDay = new Map();
  for (const record of visible) {
    const day = startOfDay(record.archivedAt);
    if (!byDay.has(day)) {
      byDay.set(day, []);
    }
    byDay.get(day).push(record);
  }
  return [...byDay].map(([day, dayRecords]) => {
    const section = document.createElement("section");
    const list = document.createElement("ul");
    list.className = "archive-list";
    list.append(...dayRecords.map(buildRow));
    section.append(dayTitle(day, today), list);
    return section;
  });
}

function matches(record, query) {
  return [record.title, record.url, record.workspaceName].some(value =>
    (value || "").toLowerCase().includes(query)
  );
}

function renderTabs() {
  for (const button of tabs.querySelectorAll(".archive-tab")) {
    const count = records.filter(r => r.kind == button.dataset.kind).length;
    button.setAttribute("aria-pressed", String(button.dataset.kind == kind));
    document.l10n.setAttributes(
      button,
      button.dataset.kind == "snooze"
        ? "peppermint-archive-tab-snoozed"
        : "peppermint-archive-tab-archived",
      { count }
    );
  }
}

function renderEmpty() {
  const hours = Services.prefs.getIntPref(PREF_HOURS, 72);
  if (kind == "archive" && hours > 0) {
    document.l10n.setAttributes(
      emptyDescription,
      "peppermint-archive-empty-description",
      { hours }
    );
  } else {
    document.l10n.setAttributes(
      emptyDescription,
      "peppermint-archive-empty-off-description"
    );
  }
}

function render() {
  privateNote.hidden = !isPrivate;
  if (isPrivate) {
    groups.replaceChildren();
    tabs.hidden = search.hidden = clearButton.hidden = true;
    emptyState.hidden = noResults.hidden = true;
    return;
  }
  const query = search.value.trim().toLowerCase();
  renderTabs();
  const ofKind = records.filter(record => record.kind == kind);
  const visible = ofKind.filter(record => !query || matches(record, query));
  if (kind == "snooze") {
    visible.sort((a, b) => a.wakeAt - b.wakeAt);
  }
  groups.replaceChildren(...buildGroups(visible));
  renderEmpty();
  emptyState.hidden = !!ofKind.length;
  noResults.hidden = !ofKind.length || !!visible.length;
  clearButton.hidden = !ofKind.length;
}

async function load() {
  records = isPrivate ? [] : await listRecords();
  render();
}

async function restore(id, where) {
  errorNote.hidden = true;
  const win = window.browsingContext.topChromeWindow;
  const tab = await restoreRecord(id, win, { select: where != "background" });
  if (!tab) {
    errorNote.hidden = false;
    await load();
  }
}

function resetClearButton() {
  clearTimeout(confirmTimer);
  confirmTimer = null;
  clearButton.classList.remove("confirming");
  document.l10n.setAttributes(clearButton, "peppermint-archive-clear-all");
}

// Moving focus away abandons the confirmation instead of leaving it armed.
clearButton.addEventListener("blur", () => {
  if (confirmTimer) {
    resetClearButton();
  }
});

clearButton.addEventListener("click", () => {
  if (!confirmTimer) {
    clearButton.classList.add("confirming");
    clearButton.setAttribute("aria-live", "polite");
    document.l10n.setAttributes(
      clearButton,
      "peppermint-archive-clear-confirm"
    );
    confirmTimer = setTimeout(resetClearButton, CONFIRM_RESET_MS);
    return;
  }
  resetClearButton();
  clearRecords(kind);
});

tabs.addEventListener("click", event => {
  const button = event.target.closest(".archive-tab");
  if (button) {
    kind = button.dataset.kind;
    resetClearButton();
    render();
  }
});

groups.addEventListener("click", event => {
  const item = event.target.closest(".archive-item");
  if (!item) {
    return;
  }
  if (event.target.closest(".archive-remove")) {
    removeRecord(item.dataset.id);
  } else if (
    event.target.closest(".archive-restore") ||
    event.target.closest(".archive-link")
  ) {
    event.preventDefault();
    restore(
      item.dataset.id,
      event.ctrlKey || event.metaKey ? "background" : ""
    );
  }
});

search.addEventListener("input", render);

// Another window archiving or restoring a tab changes this list too.
const observer = { observe: () => load() };
Services.obs.addObserver(observer, STORE_CHANGED_TOPIC);
window.addEventListener(
  "unload",
  () => Services.obs.removeObserver(observer, STORE_CHANGED_TOPIC),
  { once: true }
);

load();
