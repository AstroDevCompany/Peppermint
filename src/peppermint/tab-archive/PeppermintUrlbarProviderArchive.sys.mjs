/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { UrlbarProvider } from "moz-src:///browser/components/urlbar/UrlbarUtils.sys.mjs";
import { ProvidersManager } from "moz-src:///browser/components/urlbar/UrlbarProvidersManager.sys.mjs";
import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";
import { rankTabs } from "moz-src:///peppermint/urlbar/PeppermintUrlbarProviderTabSearch.sys.mjs";
import { restoreRecord } from "moz-src:///peppermint/tab-archive/PeppermintTabArchive.sys.mjs";
import { listRecords } from "moz-src:///peppermint/tab-archive/PeppermintTabArchiveStore.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  UrlbarResult: "chrome://browser/content/urlbar/UrlbarResult.mjs",
  UrlbarShared: "chrome://browser/content/urlbar/UrlbarShared.mjs",
});

ChromeUtils.defineLazyGetter(lazy, "l10n", () => {
  return new Localization(["browser/peppermint-tab-archive.ftl"], true);
});

XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "enabled",
  "peppermint.urlbar.tab-search.enabled",
  true
);

const PROVIDER_NAME = "PeppermintUrlbarProviderArchive";
const DYNAMIC_RESULT_TYPE = "peppermint-tab-archive";
const MAX_RESULTS = 3;

const VIEW_TEMPLATE = {
  attributes: {
    selectable: true,
  },
  children: [
    {
      name: "content",
      tag: "span",
      classList: ["urlbarView-no-wrap"],
      children: [
        {
          name: "icon",
          tag: "img",
          classList: ["urlbarView-favicon"],
        },
        {
          name: "title",
          tag: "strong",
          attributes: {
            dir: "auto",
          },
        },
        {
          name: "detail",
          tag: "span",
        },
        {
          name: "action",
          tag: "span",
        },
      ],
    },
  ],
};

const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * Archived and snoozed tabs in tab search mode (the % restriction, or "Search
 * Tabs" in the command palette), below the tabs that are open.
 */
export class PeppermintUrlbarProviderArchive extends UrlbarProvider {
  get name() {
    return PROVIDER_NAME;
  }

  get type() {
    return lazy.UrlbarShared.PROVIDER_TYPE.PROFILE;
  }

  getPriority() {
    // Same as the open tab search, or the manager would drop this provider.
    return 1;
  }

  async isActive(queryContext) {
    return (
      lazy.enabled &&
      !queryContext.isPrivate &&
      !!queryContext.tokens.length &&
      queryContext.searchMode?.source === lazy.UrlbarShared.RESULT_SOURCE.TABS
    );
  }

  getViewTemplate() {
    return VIEW_TEMPLATE;
  }

  getViewUpdate(result) {
    const { kind, url, title, archivedAt, wakeAt } = result.payload;
    const detail =
      kind == "snooze"
        ? lazy.l10n.formatValueSync("peppermint-archive-result-snoozed", {
            date: dateFormat.format(wakeAt),
          })
        : lazy.l10n.formatValueSync("peppermint-archive-result-archived", {
            date: dateFormat.format(archivedAt),
          });
    return {
      icon: { attributes: { src: `page-icon:${url}` } },
      title: { textContent: title },
      detail: { textContent: ` ${detail}` },
      action: {
        textContent: lazy.l10n.formatValueSync("peppermint-archive-restore"),
      },
    };
  }

  async startQuery(queryContext, addCallback) {
    const tokens = queryContext.tokens.map(token => token.lowerCaseValue);
    const entries = (await listRecords()).map(record => ({
      title: record.title,
      url: record.url,
      space: record.workspaceName,
      lastAccessed: record.archivedAt,
      record,
    }));
    for (const { record } of rankTabs(tokens, entries).slice(0, MAX_RESULTS)) {
      addCallback(
        this,
        new lazy.UrlbarResult({
          type: lazy.UrlbarShared.RESULT_TYPE.DYNAMIC,
          source: lazy.UrlbarShared.RESULT_SOURCE.TABS,
          suggestedIndex: -1,
          payload: {
            dynamicType: DYNAMIC_RESULT_TYPE,
            recordId: record.id,
            kind: record.kind,
            url: record.url,
            title: record.title,
            archivedAt: record.archivedAt,
            wakeAt: record.wakeAt || 0,
          },
        })
      );
    }
  }

  onEngagement(queryContext, controller, details) {
    restoreRecord(
      details.result.payload.recordId,
      details.element?.documentGlobal
    ).catch(error => console.error("Restoring a tab failed", error));
  }
}

export function registerArchiveProvider() {
  const manager = ProvidersManager.getInstanceForSap("urlbar");
  if (!manager.getProvider(PROVIDER_NAME)) {
    manager.registerProvider(new PeppermintUrlbarProviderArchive());
  }
}
