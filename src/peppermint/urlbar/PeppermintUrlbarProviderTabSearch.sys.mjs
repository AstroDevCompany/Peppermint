/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  UrlbarProvider,
  UrlbarUtils,
} from "moz-src:///browser/components/urlbar/UrlbarUtils.sys.mjs";
import { ProvidersManager } from "moz-src:///browser/components/urlbar/UrlbarProvidersManager.sys.mjs";
import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
  UrlbarResult: "chrome://browser/content/urlbar/UrlbarResult.mjs",
  UrlbarShared: "chrome://browser/content/urlbar/UrlbarShared.mjs",
});

XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "enabled",
  "peppermint.urlbar.tab-search.enabled",
  true
);

const PROVIDER_NAME = "PeppermintUrlbarProviderTabSearch";

const WORD_START = /[\s/.\-_:?&=#]/;

// A short token matched as scattered letters would match almost anything.
const MIN_FUZZY_LENGTH = 3;

const TITLE_WEIGHT = 1;
const URL_WEIGHT = 0.6;
const SPACE_WEIGHT = 0.5;

function isSubsequence(token, text) {
  let at = 0;
  for (const char of text) {
    if (char === token[at] && ++at === token.length) {
      return true;
    }
  }
  return false;
}

/**
 * How well one search word fits one piece of text. A whole-word start scores
 * highest, a match inside a word lower, and letters that appear in order but
 * not together ("gthb" for "github") lowest.
 *
 * @param {string} token - Lower case search word
 * @param {string} text - Lower case text to look in
 * @returns {number} 0 when it does not match
 */
function tokenScore(token, text) {
  if (!text) {
    return 0;
  }
  const index = text.indexOf(token);
  if (index >= 0) {
    return index === 0 || WORD_START.test(text[index - 1]) ? 100 : 60;
  }
  return token.length >= MIN_FUZZY_LENGTH && isSubsequence(token, text) ? 20 : 0;
}

/**
 * Scores a tab against the search words. Every word has to match the title,
 * the address or the name of the space the tab is in.
 *
 * @param {string[]} tokens - Lower case search words
 * @param {{title: string, url: string, space?: string}} tab
 * @returns {number} 0 when the tab does not match, higher is better
 */
export function scoreTab(tokens, { title, url, space = "" }) {
  const titleText = title.toLowerCase();
  const urlText = url.toLowerCase();
  const spaceText = space.toLowerCase();
  let total = 0;
  for (const token of tokens) {
    const best = Math.max(
      tokenScore(token, titleText) * TITLE_WEIGHT,
      tokenScore(token, urlText) * URL_WEIGHT,
      tokenScore(token, spaceText) * SPACE_WEIGHT
    );
    if (!best) {
      return 0;
    }
    total += best;
  }
  return total / tokens.length;
}

/**
 * Ranks tabs for a query: best match first, then the most recently used. An
 * empty query lists the most recently used tabs.
 *
 * @template {{title: string, url: string, space?: string, lastAccessed: number}} T
 * @param {string[]} tokens
 * @param {T[]} tabs
 * @returns {T[]}
 */
export function rankTabs(tokens, tabs) {
  return tabs
    .map(tab => ({ tab, score: tokens.length ? scoreTab(tokens, tab) : 1 }))
    .filter(entry => entry.score > 0)
    .sort(
      (a, b) => b.score - a.score || b.tab.lastAccessed - a.tab.lastAccessed
    )
    .map(entry => entry.tab);
}

function spaceNameOf(win, tab) {
  try {
    const id = tab.getAttribute("zen-workspace-id");
    return id ? win.gZenWorkspaces?.getWorkspaceFromId(id)?.name || "" : "";
  } catch {
    return "";
  }
}

function collectTabs(queryContext) {
  const tabs = [];
  for (const win of lazy.BrowserWindowTracker.orderedWindows) {
    if (
      win.closed ||
      !win.gBrowser ||
      lazy.PrivateBrowsingUtils.isWindowPrivate(win) !== !!queryContext.isPrivate
    ) {
      continue;
    }
    const selected = win.gBrowser.selectedTab;
    for (const tab of win.gBrowser.tabs) {
      if (
        tab === selected ||
        tab.closing ||
        tab.hasAttribute("zen-empty-tab") ||
        tab.hasAttribute("zen-glance-tab")
      ) {
        continue;
      }
      let url = "";
      try {
        url = tab.linkedBrowser?.currentURI?.spec || "";
      } catch {
        continue;
      }
      if (!url || url === "about:blank") {
        continue;
      }
      tabs.push({
        title: tab.label || url,
        url,
        space: spaceNameOf(win, tab),
        lastAccessed: tab.lastAccessed || 0,
        userContextId: tab.userContextId || 0,
        tabGroup: tab.group?.id,
        icon: tab.getAttribute("image") || "",
      });
    }
  }
  return tabs;
}

/**
 * Tab search mode (the % restriction, or "Search Tabs" in the command
 * palette). Looks at the tabs of every space, not just the one on screen,
 * matches loosely, and puts the most recently used first. Picking a result
 * goes to that tab through the normal switch-to-tab path, which also changes
 * space when the tab lives in another one.
 */
export class PeppermintUrlbarProviderTabSearch extends UrlbarProvider {
  get name() {
    return PROVIDER_NAME;
  }

  get type() {
    return lazy.UrlbarShared.PROVIDER_TYPE.PROFILE;
  }

  getPriority() {
    // Outranks the stock open tab providers, so they stay quiet in this mode.
    return 1;
  }

  async isActive(queryContext) {
    return (
      lazy.enabled &&
      queryContext.searchMode?.source === lazy.UrlbarShared.RESULT_SOURCE.TABS
    );
  }

  async startQuery(queryContext, addCallback) {
    const tokens = queryContext.tokens.map(token => token.lowerCaseValue);
    const ranked = rankTabs(tokens, collectTabs(queryContext));
    for (const tab of ranked.slice(0, queryContext.maxResults)) {
      addCallback(
        this,
        new lazy.UrlbarResult({
          type: lazy.UrlbarShared.RESULT_TYPE.TAB_SWITCH,
          source: lazy.UrlbarShared.RESULT_SOURCE.TABS,
          payload: {
            url: tab.url,
            title: tab.title,
            icon: tab.icon || lazy.UrlbarShared.getIconForUrl(tab.url),
            userContext: UrlbarUtils.getUserContextData(tab.userContextId),
            tabGroup: tab.tabGroup,
          },
          highlights: {
            url: lazy.UrlbarShared.HIGHLIGHT.TYPED,
            title: lazy.UrlbarShared.HIGHLIGHT.TYPED,
          },
        })
      );
    }
  }
}

export function registerTabSearchProvider() {
  const manager = ProvidersManager.getInstanceForSap("urlbar");
  if (!manager.getProvider(PROVIDER_NAME)) {
    manager.registerProvider(new PeppermintUrlbarProviderTabSearch());
  }
}

/**
 * Opens the URL bar in tab search mode.
 *
 * @param {Window} win - A browser window
 */
export function openTabSearch(win) {
  const { gURLBar } = win;
  gURLBar.focus();
  // Not a preview: a preview mode is dropped again while the input is empty.
  gURLBar.searchMode = {
    source: lazy.UrlbarShared.RESULT_SOURCE.TABS,
    entry: "shortcut",
    isPreview: false,
  };
  gURLBar.startQuery({ allowAutofill: false });
}
