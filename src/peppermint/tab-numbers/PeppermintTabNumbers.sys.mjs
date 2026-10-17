/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Shows the number of the shortcut that selects a tab in place of the tab's
 * icon, for as long as the modifier of that shortcut is held (Command on
 * macOS, Control on Windows, Alt on Linux).
 *
 * The numbering mirrors gBrowser.selectTabAtIndex: 1 to 8 select the first
 * eight visible tabs, and 9 selects the last one.
 */

import { AppConstants } from "resource://gre/modules/AppConstants.sys.mjs";

const STYLE_URL =
  "chrome://browser/content/zen-styles/peppermint-tab-numbers.css";
const HTML_NS = "http://www.w3.org/1999/xhtml";
const NUMBER_CLASS = "peppermint-tab-number";
const ICON_STACK_SELECTOR = ".tab-icon-stack";
const MAX_DIRECT_TABS = 8;
const LAST_TAB_NUMBER = 9;
// Short enough to feel instant, long enough that a quick Command+C or
// Command+T does not flash every icon in the sidebar.
const SHOW_DELAY_MS = 150;
const REFRESH_EVENTS = [
  "TabOpen",
  "TabClose",
  "TabMove",
  "TabSelect",
  "TabShow",
  "TabHide",
];

/**
 * @param {number} count How many tabs are visible
 * @param {number} index Position of a tab among them
 * @returns {number|null} The number that selects the tab, if any does
 */
export function shortcutNumberForIndex(count, index) {
  if (index < MAX_DIRECT_TABS) {
    return index + 1;
  }
  return index === count - 1 ? LAST_TAB_NUMBER : null;
}

/**
 * @param {KeyboardEvent} event
 * @returns {boolean} Whether the modifier that selects tabs by number is down
 */
function isTabModifierHeld(event) {
  switch (AppConstants.platform) {
    case "macosx":
      return event.metaKey;
    case "linux":
      return event.altKey;
    default:
      return event.ctrlKey;
  }
}

class TabNumbersWindow {
  #win;
  #showTimer = 0;
  #refreshFrame = 0;
  #visible = false;

  constructor(win) {
    this.#win = win;
  }

  init() {
    const doc = this.#win.document;
    if (!doc.querySelector(`link[href="${STYLE_URL}"]`)) {
      const link = doc.createElement("link");
      link.rel = "stylesheet";
      link.href = STYLE_URL;
      (doc.querySelector("linkset") || doc.documentElement).appendChild(link);
    }
    // Capture, so a handler that stops the event cannot hide a key change.
    this.#win.addEventListener("keydown", this, true);
    this.#win.addEventListener("keyup", this, true);
    // The keyup is never seen when the window loses focus while held.
    this.#win.addEventListener("blur", this);
    this.#win.addEventListener("unload", () => this.#hide(), { once: true });
  }

  handleEvent(event) {
    switch (event.type) {
      case "keydown":
      case "keyup":
        if (isTabModifierHeld(event)) {
          this.#scheduleShow();
        } else {
          this.#hide();
        }
        break;
      case "blur":
        if (event.target === this.#win) {
          this.#hide();
        }
        break;
      default:
        this.#scheduleRefresh();
    }
  }

  #scheduleShow() {
    if (this.#visible || this.#showTimer) {
      return;
    }
    this.#showTimer = this.#win.setTimeout(() => {
      this.#showTimer = 0;
      this.#visible = true;
      for (const type of REFRESH_EVENTS) {
        this.#win.gBrowser.tabContainer.addEventListener(type, this);
      }
      this.#render();
    }, SHOW_DELAY_MS);
  }

  #hide() {
    if (this.#showTimer) {
      this.#win.clearTimeout(this.#showTimer);
      this.#showTimer = 0;
    }
    if (!this.#visible) {
      return;
    }
    this.#visible = false;
    if (this.#refreshFrame) {
      this.#win.cancelAnimationFrame(this.#refreshFrame);
      this.#refreshFrame = 0;
    }
    const tabContainer = this.#win.gBrowser?.tabContainer;
    for (const type of REFRESH_EVENTS) {
      tabContainer?.removeEventListener(type, this);
    }
    this.#clear();
  }

  // Tab events fire before the tab list settles, so wait for the next frame.
  #scheduleRefresh() {
    if (!this.#visible || this.#refreshFrame) {
      return;
    }
    this.#refreshFrame = this.#win.requestAnimationFrame(() => {
      this.#refreshFrame = 0;
      if (this.#visible) {
        this.#render();
      }
    });
  }

  #render() {
    this.#clear();
    const tabs = this.#win.gBrowser.visibleTabs;
    tabs.forEach((tab, index) => {
      const number = shortcutNumberForIndex(tabs.length, index);
      const stack = tab.querySelector(ICON_STACK_SELECTOR);
      if (number === null || !stack) {
        return;
      }
      const label = this.#win.document.createElementNS(HTML_NS, "span");
      label.className = NUMBER_CLASS;
      label.textContent = number;
      stack.setAttribute("peppermint-tab-number", number);
      stack.appendChild(label);
    });
  }

  #clear() {
    const doc = this.#win.document;
    for (const label of doc.querySelectorAll(`.${NUMBER_CLASS}`)) {
      label.remove();
    }
    for (const stack of doc.querySelectorAll(
      `${ICON_STACK_SELECTOR}[peppermint-tab-number]`
    )) {
      stack.removeAttribute("peppermint-tab-number");
    }
  }
}

export const PeppermintTabNumbers = {
  init(win) {
    new TabNumbersWindow(win).init();
  },
};
