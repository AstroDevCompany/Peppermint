/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Tab islands: a tab and the tabs it opens (links, target=_blank, window.open,
 * middle click) are grouped into a colored, collapsible island.
 *
 * An island is a native tab-group flagged with the "peppermint-island"
 * attribute. The flag is derived from the group id prefix, which session
 * store keeps, so islands survive a restart without touching session store.
 * Once the opener is in an island, tabbrowser itself adds further children to
 * it; this module only creates the island and dissolves it when it is left
 * with a single tab.
 */

const PREF_ENABLED = "peppermint.tabs.islands.enabled";
const FTL_FILE = "browser/peppermint-tab-islands.ftl";
const STYLE_URL =
  "chrome://browser/content/zen-styles/peppermint-tab-islands.css";
const MENU_ID = "peppermint-island-menu";
const ISLAND_ATTR = "peppermint-island";
const READY_ATTR = "peppermint-island-ready";
const ID_PREFIX = "peppermint-island-";

/**
 * @param {string} id A tab group id
 * @returns {boolean} Whether the id was minted for an island
 */
export function isIslandId(id) {
  return typeof id == "string" && id.startsWith(ID_PREFIX);
}

/**
 * @param {MozTabbrowserTab} opener The tab that opened the other one
 * @param {MozTabbrowserTab} tab The newly opened tab
 * @returns {boolean} Whether the two should be grouped into a new island
 */
export function canFormIsland(opener, tab) {
  if (!opener || !tab || opener === tab || !opener.isConnected) {
    return false;
  }
  if (opener.closing || tab.closing) {
    return false;
  }
  for (const candidate of [opener, tab]) {
    if (
      candidate.pinned ||
      candidate.group ||
      candidate.splitView ||
      candidate.hasAttribute("zen-essential") ||
      candidate.hasAttribute("zen-empty-tab") ||
      candidate.hasAttribute("zen-glance-tab")
    ) {
      return false;
    }
  }
  return (
    opener.getAttribute("zen-workspace-id") ===
    tab.getAttribute("zen-workspace-id")
  );
}

/**
 * @param {MozTabbrowserTab} tab
 * @returns {boolean} Whether the tab is a view-source tab, which is opened as
 *   related to the current tab but is not browsing from it
 */
function isViewSource(tab) {
  const browser = tab.linkedBrowser;
  const spec = browser?.userTypedValue || browser?.currentURI?.spec || "";
  return spec.startsWith("view-source:");
}

/**
 * @param {MozTabbrowserTabGroup} group
 * @returns {MozTabbrowserTab[]} The tabs of the group that are not closing
 */
function liveTabs(group) {
  return group.tabs.filter(tab => !tab.closing);
}

class TabIslandsWindow {
  #win;
  #menu = null;
  #menuGroup = null;
  #scanTimer = 0;

  constructor(win) {
    this.#win = win;
  }

  init() {
    const win = this.#win;
    const doc = win.document;
    win.MozXULElement.insertFTLIfNeeded(FTL_FILE);
    if (!doc.querySelector(`link[href="${STYLE_URL}"]`)) {
      const link = doc.createElement("link");
      link.rel = "stylesheet";
      link.href = STYLE_URL;
      (doc.querySelector("linkset") || doc.documentElement).appendChild(link);
    }

    for (const group of doc.querySelectorAll("tab-group")) {
      this.#adopt(group);
    }

    for (const type of [
      "TabOpen",
      "TabClose",
      "TabGroupCreate",
      "TabGrouped",
      "TabUngrouped",
      "dragend",
    ]) {
      win.addEventListener(type, this);
    }
    // Capture, so the tab context menu never gets to claim the island header.
    win.addEventListener("contextmenu", this, true);
    win.addEventListener("unload", () => this.#destroy(), { once: true });
  }

  #destroy() {
    if (this.#scanTimer) {
      this.#win.clearTimeout(this.#scanTimer);
      this.#scanTimer = 0;
    }
  }

  handleEvent(event) {
    switch (event.type) {
      case "TabOpen":
        this.#win.setTimeout(() => this.#onTabOpened(event.target), 0);
        break;
      case "TabGroupCreate":
        this.#adopt(event.target);
        break;
      case "TabClose":
      case "TabGrouped":
      case "TabUngrouped":
      case "dragend":
        this.#scheduleScan();
        break;
      case "contextmenu":
        this.#onContextMenu(event);
        break;
      case "command":
        this.#onMenuCommand(event);
        break;
      case "popupshowing":
        this.#updateMenu();
        break;
    }
  }

  #adopt(group) {
    if (!isIslandId(group.id) || group.hasAttribute(ISLAND_ATTR)) {
      return;
    }
    group.setAttribute(ISLAND_ATTR, "");
    group.saveOnWindowClose = false;
  }

  #onTabOpened(tab) {
    if (!Services.prefs.getBoolPref(PREF_ENABLED, true)) {
      return;
    }
    const opener = tab.openerTab;
    if (!canFormIsland(opener, tab) || isViewSource(tab)) {
      return;
    }
    const group = this.#win.gBrowser.addTabGroup([opener, tab], {
      id: `${ID_PREFIX}${Date.now()}-${Math.round(Math.random() * 1000)}`,
      insertBefore: opener,
    });
    group?.setAttribute(READY_ATTR, "");
  }

  #scheduleScan() {
    if (this.#scanTimer) {
      return;
    }
    this.#scanTimer = this.#win.setTimeout(() => {
      this.#scanTimer = 0;
      this.#scanIslands();
    }, 0);
  }

  /**
   * Marks islands that have held several tabs as ready, and ungroups the
   * ready ones that are down to a single tab. An island that was only just
   * restored may still be filling up, which is why it must have been seen
   * with several tabs before it can dissolve.
   */
  #scanIslands() {
    const { gBrowser, document } = this.#win;
    if (gBrowser.tabContainer.hasAttribute("movingtab")) {
      return;
    }
    for (const group of document.querySelectorAll(
      `tab-group[${ISLAND_ATTR}]`
    )) {
      const count = liveTabs(group).length;
      if (count > 1) {
        group.setAttribute(READY_ATTR, "");
      } else if (count == 1 && group.hasAttribute(READY_ATTR)) {
        group.ungroupTabs();
      }
    }
  }

  #onContextMenu(event) {
    const container = event.target.closest?.(".tab-group-label-container");
    const group = container?.parentElement;
    if (!group?.hasAttribute(ISLAND_ATTR)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.#menuGroup = group;
    this.#ensureMenu().openPopupAtScreen(event.screenX, event.screenY, true);
  }

  #ensureMenu() {
    if (this.#menu) {
      return this.#menu;
    }
    const doc = this.#win.document;
    const menu = doc.createXULElement("menupopup");
    menu.id = MENU_ID;
    for (const [action, l10nId] of [
      ["toggle", "peppermint-island-collapse"],
      ["rename", "peppermint-island-rename"],
      ["ungroup", "peppermint-island-ungroup"],
      ["close", "peppermint-island-close"],
    ]) {
      const item = doc.createXULElement("menuitem");
      item.setAttribute("data-action", action);
      doc.l10n.setAttributes(item, l10nId);
      menu.appendChild(item);
    }
    menu.addEventListener("command", this);
    menu.addEventListener("popupshowing", this);
    (doc.getElementById("mainPopupSet") || doc.documentElement).appendChild(
      menu
    );
    this.#menu = menu;
    return menu;
  }

  #updateMenu() {
    const toggle = this.#menu.querySelector('[data-action="toggle"]');
    this.#win.document.l10n.setAttributes(
      toggle,
      this.#menuGroup?.collapsed
        ? "peppermint-island-expand"
        : "peppermint-island-collapse"
    );
  }

  #onMenuCommand(event) {
    const group = this.#menuGroup;
    this.#menuGroup = null;
    if (!group?.isConnected) {
      return;
    }
    const { gBrowser } = this.#win;
    const { TabMetrics } = ChromeUtils.importESModule(
      "moz-src:///browser/components/tabbrowser/TabMetrics.sys.mjs"
    );
    const metricsContext = TabMetrics.userTriggeredContext(
      TabMetrics.METRIC_SOURCE.TAB_GROUP_MENU
    );
    switch (event.target.getAttribute("data-action")) {
      case "toggle":
        group.collapsed = !group.collapsed;
        break;
      case "rename":
        gBrowser.tabGroupMenu.openEditModal(group);
        break;
      case "ungroup":
        group.ungroupTabs(metricsContext);
        break;
      case "close":
        gBrowser.removeTabGroup(group, { metricsContext });
        break;
    }
  }
}

export const PeppermintTabIslands = {
  /** @param {Window} win The browser window to add islands to */
  init(win) {
    new TabIslandsWindow(win).init();
  },
};
