/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  action,
  isWebPage,
  showToast,
} from "moz-src:///peppermint/palette/PeppermintPaletteAction.sys.mjs";

const ICONS = "chrome://browser/skin/zen-icons/";

const PREF_DISABLE_CACHE = "devtools.cache.disabled";

// Pages that are not worth deduplicating or listing.
const BLANK_URLS = new Set(["", "about:blank", "about:newtab", "about:home"]);

/**
 * @param {string} spec - A page address
 * @returns {string} The address without its fragment, so two tabs that only
 *   differ in the part after "#" count as the same page
 */
export function urlKey(spec) {
  const hash = spec.indexOf("#");
  return hash < 0 ? spec : spec.slice(0, hash);
}

/**
 * @param {string} title
 * @param {string} url
 * @returns {string} A Markdown link whose text and address survive the
 *   characters that would end the link early
 */
export function markdownLink(title, url) {
  const text = (title || url).replace(/\s+/g, " ").trim();
  const escaped = text.replace(/([\\[\]])/g, "\\$1");
  const target = url
    .replace(/ /g, "%20")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
  return `[${escaped}](${target})`;
}

/**
 * @param {{title: string, url: string}[]} pages
 * @returns {string} A Markdown bullet list of links, one page per line
 */
export function markdownList(pages) {
  return pages
    .map(({ title, url }) => `- ${markdownLink(title, url)}`)
    .join("\n");
}

/**
 * Picks the tabs that repeat a page already open. The selected tab always
 * stays; otherwise the one used most recently does.
 *
 * @param {{tab: object, url: string, lastAccessed?: number}[]} entries
 * @param {object} selected - The selected tab
 * @returns {object[]} The tabs to close
 */
export function pickDuplicates(entries, selected) {
  const groups = new Map();
  for (const entry of entries) {
    const key = urlKey(entry.url);
    if (BLANK_URLS.has(key)) {
      continue;
    }
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(entry);
  }
  const doomed = [];
  for (const group of groups.values()) {
    if (group.length < 2) {
      continue;
    }
    const keep =
      group.find(entry => entry.tab === selected) ??
      group.reduce((best, entry) =>
        (entry.lastAccessed ?? 0) > (best.lastAccessed ?? 0) ? entry : best
      );
    doomed.push(...group.filter(entry => entry !== keep).map(e => e.tab));
  }
  return doomed;
}

function tabUrl(tab) {
  try {
    return tab.linkedBrowser?.currentURI?.spec || "";
  } catch {
    return "";
  }
}

function inActiveSpace(window, tab) {
  const active = window.gZenWorkspaces?.activeWorkspace;
  const id = tab.getAttribute("zen-workspace-id");
  return !active || !id || id === active;
}

// The tabs of the space on screen, plus Essentials, in tab order.
function spaceTabs(window) {
  return window.gBrowser.nonHiddenTabs.filter(
    tab =>
      !tab.closing &&
      !tab.hasAttribute("zen-empty-tab") &&
      !tab.hasAttribute("zen-glance-tab") &&
      inActiveSpace(window, tab)
  );
}

function isClosable(tab) {
  return (
    !tab.pinned && !tab.hasAttribute("zen-essential") && !tab.group?.isZenFolder
  );
}

function duplicateTabs(window) {
  const entries = spaceTabs(window)
    .filter(isClosable)
    .map(tab => ({
      tab,
      url: tabUrl(tab),
      lastAccessed: tab.lastAccessed || 0,
    }));
  return pickDuplicates(entries, window.gBrowser.selectedTab);
}

function listedPages(window) {
  return spaceTabs(window)
    .map(tab => ({ title: tab.label, url: tabUrl(tab) }))
    .filter(({ url }) => !BLANK_URLS.has(url));
}

function copyText(text) {
  Cc["@mozilla.org/widget/clipboardhelper;1"]
    .getService(Ci.nsIClipboardHelper)
    .copyString(text);
}

function currentPage(window) {
  const { gBrowser } = window;
  return { title: gBrowser.selectedTab.label, url: gBrowser.currentURI.spec };
}

function togglePref(name) {
  Services.prefs.setBoolPref(name, !Services.prefs.getBoolPref(name, false));
}

// Developer tools register their keys lazily and not at all when a policy
// turns them off, so an entry only shows while its key exists.
function hasElement(window, id) {
  return !!window.document.getElementById(id);
}

function runElement(window, id) {
  window.document.getElementById(id)?.doCommand();
}

function copyActions() {
  const icon = `${ICONS}edit-copy.svg`;
  return [
    action(
      "copy-tab-urls",
      "peppermint-action-copy-tab-urls",
      icon,
      window => {
        const pages = listedPages(window);
        copyText(pages.map(page => page.url).join("\n"));
        showToast(window, "peppermint-tabs-copied", { count: pages.length });
      },
      window => !!listedPages(window).length
    ),
    action(
      "copy-tabs-markdown",
      "peppermint-action-copy-tabs-markdown",
      icon,
      window => {
        const pages = listedPages(window);
        copyText(markdownList(pages));
        showToast(window, "peppermint-tabs-copied", { count: pages.length });
      },
      window => !!listedPages(window).length
    ),
    action(
      "copy-page-markdown-link",
      "peppermint-action-copy-page-markdown-link",
      `${ICONS}link.svg`,
      window => {
        const { title, url } = currentPage(window);
        copyText(markdownLink(title, url));
        showToast(window, "peppermint-page-copied");
      },
      window => isWebPage(window.gBrowser.currentURI)
    ),
    action(
      "copy-page-title",
      "peppermint-action-copy-page-title",
      `${ICONS}text-title-case.svg`,
      window => {
        copyText(currentPage(window).title);
        showToast(window, "peppermint-page-copied");
      },
      window => isWebPage(window.gBrowser.currentURI)
    ),
  ];
}

/**
 * @returns {object[]} Palette entries that tidy or export the open tabs
 */
export function tabActions() {
  return [
    action(
      "close-duplicate-tabs",
      "peppermint-action-close-duplicate-tabs",
      `${ICONS}duplicate-tab.svg`,
      window => {
        const doomed = duplicateTabs(window);
        window.gBrowser.removeTabs(doomed, { animate: true });
        showToast(window, "peppermint-duplicates-closed", {
          count: doomed.length,
        });
      },
      window => !!duplicateTabs(window).length
    ),
    action(
      "close-other-tabs",
      "peppermint-action-close-other-tabs",
      `${ICONS}close.svg`,
      window => window.gBrowser.removeAllTabsBut(window.gBrowser.selectedTab),
      window =>
        spaceTabs(window).some(
          tab => tab !== window.gBrowser.selectedTab && isClosable(tab)
        )
    ),
    action(
      "close-tabs-below",
      "peppermint-action-close-tabs-below",
      `${ICONS}arrow-down.svg`,
      window =>
        window.gBrowser.removeTabsToTheEndFrom(window.gBrowser.selectedTab),
      window => {
        try {
          const { gBrowser } = window;
          return !!gBrowser._getTabsToTheEndFrom(gBrowser.selectedTab).length;
        } catch {
          return false;
        }
      }
    ),
    ...copyActions(),
  ];
}

/**
 * @returns {object[]} Palette entries for the developer tools
 */
export function devActions() {
  const icon = `${ICONS}developer.svg`;
  return [
    action(
      "toggle-responsive-design",
      "peppermint-action-toggle-responsive-design",
      `${ICONS}screen.svg`,
      window => runElement(window, "key_responsiveDesignMode"),
      window => hasElement(window, "key_responsiveDesignMode")
    ),
    action(
      "open-web-console",
      "peppermint-action-open-web-console",
      icon,
      window => runElement(window, "key_webconsole"),
      window => hasElement(window, "key_webconsole")
    ),
    action(
      "view-page-source",
      "peppermint-action-view-page-source",
      `${ICONS}brackets-curly.svg`,
      window => window.document.getElementById("View:PageSource")?.doCommand(),
      window =>
        isWebPage(window.gBrowser.currentURI) &&
        hasElement(window, "View:PageSource")
    ),
    action(
      "toggle-disable-cache",
      "peppermint-action-toggle-disable-cache",
      icon,
      () => togglePref(PREF_DISABLE_CACHE)
    ),
  ];
}
