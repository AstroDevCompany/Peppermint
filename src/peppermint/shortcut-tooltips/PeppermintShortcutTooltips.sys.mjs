/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Adds the keyboard shortcut to the tooltip of buttons that Zen and Firefox
 * label without one: the compact mode toggle at the top of the sidebar and the
 * close and split buttons inside tab entries.
 *
 * Shortcuts can be rebound, so the text is resolved when the pointer enters
 * the button, from the live <key> element. A button whose shortcut is unset
 * falls back to its plain message.
 */

import { ShortcutUtils } from "resource://gre/modules/ShortcutUtils.sys.mjs";

const COMPACT_MODE_KEY_ID = "zen-compact-mode-toggle";
const CLOSE_TAB_KEY_ID = "key_close";

/**
 * @param {Element} target The element the pointer entered
 * @param {Window} win
 * @returns {{button: Element, plainId: string, shortcutId: string, keyId: string|null, args: object}|null}
 *   How to label the button the target belongs to, if it is one of ours
 */
function describe(target, win) {
  const compact = target.closest("#zen-toggle-compact-mode toolbarbutton");
  if (compact) {
    return {
      button: compact,
      plainId: "zen-toggle-compact-mode-button",
      shortcutId: "peppermint-toggle-compact-mode-button-shortcut",
      keyId: COMPACT_MODE_KEY_ID,
      args: {},
    };
  }

  const tab = target.closest("tab");
  if (!tab) {
    return null;
  }

  const close = target.closest(".tab-close-button");
  if (close) {
    const { args } = win.document.l10n.getAttributes(close);
    return {
      button: close,
      plainId: "tabbrowser-close-tabs-button",
      shortcutId: "peppermint-tab-close-button-shortcut",
      // The shortcut closes the selected tabs, so it is only true there.
      keyId: tab.selected || tab.multiselected ? CLOSE_TAB_KEY_ID : null,
      args: { tabCount: args?.tabCount ?? 1 },
    };
  }

  const split = target.closest(".tab-split-button");
  if (split) {
    let tabCount = 1;
    if (tab.splitView) {
      tabCount = -1;
    } else if (tab.multiselected) {
      tabCount = win.gBrowser.selectedTabs.length;
    }
    // Joining tabs into a split view has no shortcut of its own.
    return {
      button: split,
      plainId: "peppermint-tab-split-button",
      shortcutId: "peppermint-tab-split-button",
      keyId: null,
      args: { tabCount },
    };
  }

  return null;
}

class ShortcutTooltipsWindow {
  #win;

  constructor(win) {
    this.#win = win;
  }

  init() {
    this.#win.document.addEventListener("mouseover", this, true);
    this.#win.addEventListener(
      "unload",
      () => this.#win.document.removeEventListener("mouseover", this, true),
      { once: true }
    );
  }

  handleEvent(event) {
    if (!event.target.closest) {
      return;
    }
    const info = describe(event.target, this.#win);
    if (!info) {
      return;
    }

    const key = info.keyId && this.#win.document.getElementById(info.keyId);
    const shortcut = key ? ShortcutUtils.prettifyShortcut(key) : "";
    const id = shortcut ? info.shortcutId : info.plainId;
    const args = shortcut ? { ...info.args, shortcut } : info.args;

    const l10n = this.#win.document.l10n;
    const current = l10n.getAttributes(info.button);
    const same =
      current.id == id &&
      Object.keys(args).length == Object.keys(current.args || {}).length &&
      Object.entries(args).every(
        ([name, value]) => current.args?.[name] === value
      );
    if (!same) {
      l10n.setAttributes(info.button, id, args);
    }
  }
}

export const PeppermintShortcutTooltips = {
  init(win) {
    new ShortcutTooltipsWindow(win).init();
  },
};
