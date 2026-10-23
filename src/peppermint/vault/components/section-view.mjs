/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { clear, h, iconButton, ICONS, initialOf } from "./dom.mjs";
import { openModal } from "./modal.mjs";

const REVEAL_MS = 30000;
const SEARCH_DEBOUNCE_MS = 150;
const CONFIRM_RESET_MS = 6000;
const MASK = "•".repeat(10);

const ERROR_L10N = {
  exists: "peppermint-vault-error-exists",
  "invalid-origin": "peppermint-vault-error-invalid-origin",
  "empty-password": "peppermint-vault-error-empty-password",
  "not-found": "peppermint-vault-error-not-found",
  "reveal-blocked": "peppermint-vault-error-reveal-blocked",
  "invalid-secret": "peppermint-vault-error-invalid-secret",
};

const CODE_TICK_MS = 1000;
const secondsFormat = new Intl.NumberFormat(undefined, {
  style: "unit",
  unit: "second",
  unitDisplay: "narrow",
});

const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function errorL10n(error) {
  return ERROR_L10N[error?.code] ?? "peppermint-vault-error-generic";
}

function openWebLink(url) {
  Services.wm
    .getMostRecentBrowserWindow()
    ?.openWebLinkIn(url, "tab", { relatedToCurrent: false });
}

/**
 * Makes a button ask for a second click before it acts. Moving focus away or
 * waiting cancels it.
 *
 * @param {HTMLElement} button
 * @param {object} options
 * @param {string} options.idleL10n
 * @param {string} options.armedL10n
 * @param {object} [options.args]
 * @param {string} [options.idleIcon]   Swapped for armedIcon while armed.
 * @param {string} [options.armedIcon]
 * @param {() => void} options.onConfirm
 */
function makeConfirmable(
  button,
  { idleL10n, armedL10n, args, idleIcon, armedIcon, onConfirm }
) {
  let timer = null;
  const show = (l10n, icon) => {
    document.l10n.setAttributes(button, l10n, args);
    const image = button.querySelector("img");
    if (image && icon) {
      image.src = icon;
    }
  };
  const reset = () => {
    clearTimeout(timer);
    timer = null;
    show(idleL10n, idleIcon);
  };
  button.addEventListener("blur", () => timer && reset());
  button.addEventListener("click", () => {
    if (!timer) {
      button.setAttribute("aria-live", "polite");
      show(armedL10n, armedIcon);
      timer = setTimeout(reset, CONFIRM_RESET_MS);
      return;
    }
    reset();
    onConfirm();
  });
}

/**
 * The list, search, filters and row actions of one section. Everything the
 * section does goes through api.call(), which handles locking and asking for
 * the Primary Password again, so this file never deals with authentication.
 *
 * @param {object} options
 * @param {object} options.section    The description from the registry.
 * @param {{ call: Function }} options.api
 * @param {Function} options.toast    toast(l10nId, args)
 * @param {string} [options.query]
 * @returns {{ element: HTMLElement, refresh: Function, destroy: Function, focusSearch: Function }}
 */
export function createSectionView({ section, api, toast, query = "" }) {
  const state = { query, filter: "all", sort: section.sorts[0]?.id ?? "" };
  const revealed = new Map();
  // Rows showing a one-time code, by item id.
  const liveCodes = new Map();
  let codeTimer = null;
  // A section can word the shared dialogs and messages for what it holds.
  const texts = section.texts ?? {};
  const sectionErrorL10n = error =>
    section.errors?.[error?.code] ?? errorL10n(error);
  let searchTimer = null;
  let generation = 0;

  const list = h("ul", {
    class: "vault-list",
    attrs: { "aria-labelledby": "vault-section-title" },
  });
  const empty = h(
    "section",
    { class: "vault-empty", attrs: { hidden: true } },
    h("img", {
      class: "vault-hero-icon",
      attrs: { src: section.icon ?? ICONS.vault, alt: "" },
    }),
    h("h2", { l10n: texts.emptyTitle ?? "peppermint-vault-empty-title" }),
    h("p", {
      class: "vault-muted",
      l10n: texts.emptyDescription ?? "peppermint-vault-empty-description",
    })
  );
  const noResults = h("p", {
    class: "vault-muted vault-note",
    l10n: "peppermint-vault-no-results",
    attrs: { hidden: true },
  });
  const count = h("p", {
    class: "vault-visually-hidden",
    attrs: { role: "status", "aria-live": "polite" },
  });

  const search = h("input", {
    class: "vault-search",
    attrs: {
      type: "search",
      autocomplete: "off",
      spellcheck: "false",
    },
    l10n: "peppermint-vault-search",
    on: {
      input() {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          state.query = search.value;
          refresh();
        }, SEARCH_DEBOUNCE_MS);
      },
    },
  });
  search.value = query;

  function select(options, key, l10n) {
    const element = h(
      "select",
      { class: "vault-select", l10n },
      options.map(option =>
        h("option", { attrs: { value: option.id }, l10n: option.l10nId })
      )
    );
    element.addEventListener("change", () => {
      state[key] = element.value;
      refresh();
    });
    return element;
  }

  const addButton = h(
    "button",
    {
      class: "vault-button vault-primary",
      attrs: { type: "button" },
      on: { click: () => openCreate(addButton) },
    },
    h("img", { class: "vault-icon", attrs: { src: ICONS.plus, alt: "" } }),
    h("span", { l10n: "peppermint-vault-add" })
  );

  const clearButton = section.clearable
    ? h("button", {
        class: "vault-button vault-danger",
        attrs: { type: "button" },
        l10n: texts.clear,
      })
    : null;
  if (clearButton) {
    makeConfirmable(clearButton, {
      idleL10n: texts.clear,
      armedL10n: texts.clearConfirm,
      async onConfirm() {
        try {
          await api.call("clear");
          refresh();
        } catch (error) {
          showFailure(error);
        }
      },
    });
  }

  const controls = h(
    "div",
    { class: "vault-toolbar", attrs: { role: "search" } },
    search,
    section.filters.length
      ? select(section.filters, "filter", "peppermint-vault-filter-label")
      : null,
    section.sorts.length
      ? select(section.sorts, "sort", "peppermint-vault-sort-label")
      : null,
    section.createFields.length ? addButton : null,
    clearButton
  );

  const element = h(
    "section",
    { class: "vault-section" },
    controls,
    count,
    list,
    empty,
    noResults
  );

  function mask(id, field) {
    const key = `${id}:${field}`;
    const entry = revealed.get(key);
    if (!entry) {
      return;
    }
    clearTimeout(entry.timer);
    revealed.delete(key);
    entry.value.textContent = MASK;
    entry.toggle.setAttribute("aria-pressed", "false");
    entry.toggle.querySelector("img").src = ICONS.eye;
    document.l10n.setAttributes(entry.toggle, "peppermint-vault-reveal", {
      site: entry.site,
    });
  }

  function maskAll() {
    for (const key of [...revealed.keys()]) {
      const [id, field] = key.split(":");
      mask(id, field);
    }
  }

  async function reveal(item, field, valueElement, toggle) {
    const key = `${item.id}:${field.id}`;
    if (revealed.has(key)) {
      mask(item.id, field.id);
      return;
    }
    try {
      valueElement.textContent = await api.call("getSecret", item.id, field.id);
    } catch (error) {
      showFailure(error);
      return;
    }
    toggle.setAttribute("aria-pressed", "true");
    toggle.querySelector("img").src = ICONS.eyeSlash;
    document.l10n.setAttributes(toggle, "peppermint-vault-hide", {
      site: item.title,
    });
    revealed.set(key, {
      value: valueElement,
      toggle,
      site: item.title,
      timer: setTimeout(() => mask(item.id, field.id), REVEAL_MS),
    });
  }

  async function copy(item, field) {
    try {
      await api.call("copy", item.id, field.id);
      const seconds = Services.prefs.getIntPref(
        "peppermint.vault.clipboard-clear-seconds",
        30
      );
      toast(
        seconds > 0
          ? "peppermint-vault-toast-copied-cleared"
          : "peppermint-vault-toast-copied",
        { seconds }
      );
    } catch (error) {
      showFailure(error);
    }
  }

  function showFailure(error) {
    if (error?.name == "VaultLockedError") {
      return;
    }
    if (error?.name != "VaultStepUpCancelled") {
      toast(errorL10n(error));
    }
  }

  async function openEdit(item, trigger) {
    let editable;
    try {
      editable = await api.call("getEditable", item.id);
    } catch (error) {
      showFailure(error);
      return;
    }
    openModal({
      titleL10n: texts.editTitle ?? "peppermint-vault-edit-title",
      submitL10n: "peppermint-vault-save",
      fields: section.editFields.map(id => fieldSpec(id, editable[id])),
      errorL10n: sectionErrorL10n,
      returnFocusTo: trigger,
      async onSubmit(values) {
        await api.call("update", item.id, values);
        refresh();
      },
      async onDelete() {
        await api.call("remove", item.id);
        refresh();
      },
    });
  }

  function fieldSpec(id, value = "") {
    const formField = section.formFields?.[id];
    if (formField) {
      return {
        id,
        kind: formField.kind,
        labelL10nId: formField.labelL10nId,
        value,
        required: !!formField.required,
      };
    }
    const field = section.fields.find(f => f.id == id) ?? {
      id,
      kind: id == "origin" ? "origin" : "text",
      labelL10nId: `peppermint-vault-field-${id == "origin" ? "website" : id}`,
    };
    return {
      id,
      kind: field.kind,
      labelL10nId: field.labelL10nId ?? `peppermint-vault-field-${id}`,
      value,
      required: id == "password" || id == "origin",
    };
  }

  function openCreate(trigger) {
    openModal({
      titleL10n: texts.addTitle ?? "peppermint-vault-add-title",
      submitL10n: "peppermint-vault-add-submit",
      fields: section.createFields.map(id => fieldSpec(id)),
      errorL10n: sectionErrorL10n,
      returnFocusTo: trigger,
      async onSubmit(values) {
        await api.call("create", values);
        refresh();
      },
    });
  }

  function renderCodeField(item, field) {
    const value = h("span", {
      class: "vault-value vault-code",
      text: item.values.code ?? "",
    });
    const timer = h("span", {
      class: "vault-code-timer",
      attrs: { "aria-hidden": "true" },
    });
    if (item.values.code) {
      liveCodes.set(item.id, {
        value,
        timer,
        expiresAt: Number(item.values.expiresAt),
      });
      updateTimer(liveCodes.get(item.id));
    } else {
      value.textContent = "";
      document.l10n.setAttributes(value, "peppermint-vault-no-value");
      value.classList.add("vault-muted");
    }
    const actions = [];
    if (field.copy && item.values.code) {
      const copyButton = iconButton(
        ICONS.copy,
        `peppermint-vault-copy-${field.id}`,
        { site: item.title }
      );
      copyButton.addEventListener("click", () => copy(item, field));
      actions.push(copyButton);
    }
    return h(
      "div",
      { class: "vault-field-row" },
      h("dt", { l10n: field.labelL10nId }),
      h(
        "dd",
        {},
        value,
        timer,
        h("span", { class: "vault-field-actions" }, actions)
      )
    );
  }

  function updateTimer(entry) {
    const seconds = Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
    entry.timer.textContent = secondsFormat.format(seconds);
    entry.timer.classList.toggle("vault-code-ending", seconds <= 5);
    return seconds;
  }

  async function refreshCodes() {
    let items;
    try {
      items = await api.call("list", {
        query: state.query,
        filter: state.filter,
        sort: state.sort,
      });
    } catch (error) {
      showFailure(error);
      return;
    }
    const sameRows =
      items.length == liveCodes.size && items.every(item => liveCodes.has(item.id));
    if (!sameRows) {
      refresh();
      return;
    }
    for (const item of items) {
      const entry = liveCodes.get(item.id);
      entry.value.textContent = item.values.code ?? "";
      entry.expiresAt = Number(item.values.expiresAt);
      updateTimer(entry);
    }
  }

  function startCodeTimer() {
    if (codeTimer || !section.fields.some(f => f.kind == "code")) {
      return;
    }
    codeTimer = setInterval(() => {
      let expired = false;
      for (const entry of liveCodes.values()) {
        expired = updateTimer(entry) == 0 || expired;
      }
      if (expired) {
        refreshCodes();
      }
    }, CODE_TICK_MS);
  }

  function renderTime(kind, time) {
    return h(
      "li",
      {},
      h("time", {
        class: "vault-time",
        attrs: { datetime: new Date(time).toISOString() },
        l10n: `peppermint-vault-time-${kind}`,
        l10nArgs: { date: dateFormat.format(time) },
      })
    );
  }

  function renderTimestamps(item) {
    const times = (item.timestamps ?? []).filter(entry => entry.time > 0);
    return times.length
      ? h(
          "ul",
          { class: "vault-times" },
          times.map(entry => renderTime(entry.kind, entry.time))
        )
      : null;
  }

  function renderChoices(item, field) {
    return item.values[field.id].map(entry => {
      const select = h(
        "select",
        {
          class: "vault-select vault-choice",
          attrs: { disabled: entry.readOnly },
          l10n: "peppermint-vault-choice-label",
          l10nArgs: { permission: entry.label, site: item.title },
        },
        entry.options.map(option =>
          h("option", { attrs: { value: option.value }, text: option.label })
        )
      );
      select.value = entry.state;
      select.addEventListener("change", async () => {
        try {
          await api.call("update", item.id, {
            permission: entry.key,
            state: select.value,
          });
          toast("peppermint-vault-toast-saved");
        } catch (error) {
          showFailure(error);
        }
        refresh();
      });
      return h(
        "div",
        { class: "vault-field-row" },
        h("dt", { text: entry.label }),
        h(
          "dd",
          {},
          select,
          h(
            "span",
            { class: "vault-choice-note vault-muted" },
            entry.readOnly
              ? h("span", { l10n: "peppermint-vault-permissions-managed" })
              : entry.session
                ? h("span", { l10n: "peppermint-vault-permissions-session" })
                : null,
            entry.time > 0
              ? h("time", {
                  attrs: { datetime: new Date(entry.time).toISOString() },
                  l10n: "peppermint-vault-time-modified",
                  l10nArgs: { date: dateFormat.format(entry.time) },
                })
              : null
          )
        )
      );
    });
  }

  function renderRow(item) {
    const site = item.link
      ? h("a", {
          class: "vault-site",
          attrs: { href: item.link, rel: "noopener noreferrer" },
          text: item.title,
          on: {
            click(event) {
              event.preventDefault();
              openWebLink(item.link);
            },
            auxclick(event) {
              if (event.button == 1) {
                event.preventDefault();
                openWebLink(item.link);
              }
            },
          },
        })
      : h("span", { class: "vault-site", text: item.title });

    const editButton = section.editFields.length
      ? iconButton(ICONS.edit, "peppermint-vault-edit", { site: item.title })
      : null;
    editButton?.addEventListener("click", () => openEdit(item, editButton));

    let removeButton = null;
    if (section.removable) {
      removeButton = iconButton(ICONS.delete, texts.removeRow, {
        site: item.title,
      });
      makeConfirmable(removeButton, {
        idleL10n: texts.removeRow,
        armedL10n: texts.removeRowConfirm,
        args: { site: item.title },
        idleIcon: ICONS.delete,
        armedIcon: ICONS.check,
        async onConfirm() {
          try {
            await api.call("remove", item.id);
          } catch (error) {
            showFailure(error);
          }
          refresh();
        },
      });
    }

    const fields = section.fields.flatMap(field => {
      if (field.kind == "choices") {
        return renderChoices(item, field);
      }
      if (field.kind == "code") {
        return renderCodeField(item, field);
      }
      const secret = field.kind == "secret";
      const text = secret ? MASK : (item.values[field.id] ?? "");
      const value = h("span", {
        class: secret ? "vault-value vault-secret" : "vault-value",
        attrs: { title: secret ? null : text || null },
        text,
      });
      if (!secret && !item.values[field.id]) {
        value.textContent = "";
        document.l10n.setAttributes(value, "peppermint-vault-no-value");
        value.classList.add("vault-muted");
      }
      const actions = [];
      if (field.reveal) {
        const toggle = iconButton(ICONS.eye, "peppermint-vault-reveal", {
          site: item.title,
        });
        toggle.setAttribute("aria-pressed", "false");
        toggle.addEventListener("click", () =>
          reveal(item, field, value, toggle)
        );
        actions.push(toggle);
      }
      if (field.copy) {
        const copyButton = iconButton(
          ICONS.copy,
          `peppermint-vault-copy-${field.id}`,
          { site: item.title }
        );
        copyButton.addEventListener("click", () => copy(item, field));
        actions.push(copyButton);
      }
      return h(
        "div",
        { class: "vault-field-row" },
        h("dt", { l10n: field.labelL10nId }),
        h("dd", {}, value, h("span", { class: "vault-field-actions" }, actions))
      );
    });

    return h(
      "li",
      { class: "vault-row", attrs: { "data-id": item.id, tabindex: "-1" } },
      h(
        "div",
        { class: "vault-row-head" },
        h("span", {
          class: "vault-tile",
          attrs: { "aria-hidden": "true" },
          text: initialOf(item.title),
        }),
        h(
          "div",
          { class: "vault-row-title" },
          site,
          item.insecure
            ? h("span", {
                class: "vault-badge",
                l10n: "peppermint-vault-insecure",
              })
            : null
        ),
        editButton,
        removeButton
      ),
      h("dl", { class: "vault-fields" }, fields),
      renderTimestamps(item)
    );
  }

  async function refresh() {
    const mine = ++generation;
    let items;
    try {
      items = await api.call("list", {
        query: state.query,
        filter: state.filter,
        sort: state.sort,
      });
    } catch (error) {
      showFailure(error);
      return;
    }
    if (mine != generation) {
      return;
    }
    maskAll();
    clear(list);
    liveCodes.clear();
    list.append(...items.map(renderRow));
    startCodeTimer();
    const filtered = !!state.query.trim() || state.filter != "all";
    empty.hidden = !!items.length || filtered;
    noResults.hidden = !!items.length || !filtered;
    list.hidden = !items.length;
    document.l10n.setAttributes(count, "peppermint-vault-result-count", {
      count: items.length,
    });
  }

  element.addEventListener("keydown", event => {
    if (event.key != "ArrowDown" && event.key != "ArrowUp") {
      return;
    }
    if (event.target.closest("select, dialog")) {
      return;
    }
    const rows = [...list.querySelectorAll(".vault-row")];
    const current = event.target.closest(".vault-row");
    const index = current ? rows.indexOf(current) : -1;
    const next = rows[index + (event.key == "ArrowDown" ? 1 : -1)];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  });

  return {
    element,
    refresh,
    focusSearch: () => search.focus(),
    destroy() {
      clearTimeout(searchTimer);
      clearInterval(codeTimer);
      codeTimer = null;
      liveCodes.clear();
      generation++;
      maskAll();
      clear(list);
    },
  };
}
