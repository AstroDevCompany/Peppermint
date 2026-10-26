/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { UrlbarProvider } from "moz-src:///browser/components/urlbar/UrlbarUtils.sys.mjs";
import { ProvidersManager } from "moz-src:///browser/components/urlbar/UrlbarProvidersManager.sys.mjs";
import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";
import {
  matchOmniTool,
  omniResults,
} from "moz-src:///peppermint/omni-utils/PeppermintOmniUtils.sys.mjs";
import { showToast } from "moz-src:///peppermint/palette/PeppermintPaletteAction.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  UrlbarResult: "chrome://browser/content/urlbar/UrlbarResult.mjs",
  UrlbarShared: "chrome://browser/content/urlbar/UrlbarShared.mjs",
});

ChromeUtils.defineLazyGetter(lazy, "l10n", () => {
  return new Localization(["browser/peppermint-omni-utils.ftl"], true);
});

XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "enabled",
  "peppermint.urlbar.omni-utils.enabled",
  true
);

XPCOMUtils.defineLazyServiceGetter(
  lazy,
  "ClipboardHelper",
  "@mozilla.org/widget/clipboardhelper;1",
  Ci.nsIClipboardHelper
);

const PROVIDER_NAME = "PeppermintUrlbarProviderOmniUtils";
const DYNAMIC_RESULT_TYPE = "peppermint-omni-utils";
const MAX_DISPLAY_LENGTH = 100;

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
          attributes: {
            src: "chrome://global/skin/icons/edit-copy.svg",
          },
        },
        {
          name: "label",
          tag: "span",
        },
        {
          name: "output",
          tag: "strong",
          attributes: {
            dir: "ltr",
          },
        },
        {
          name: "action",
          tag: "span",
        },
      ],
    },
  ],
};

/**
 * @param {string} value
 * @returns {string} The value on one line, cut to fit a result row
 */
export function displayValue(value) {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > MAX_DISPLAY_LENGTH
    ? `${line.slice(0, MAX_DISPLAY_LENGTH)}…`
    : line;
}

/**
 * Answers searches that are meant for a small developer tool ("jwt ...",
 * "b64 ...", "ts ...", a color). Picking an answer copies it.
 */
export class PeppermintUrlbarProviderOmniUtils extends UrlbarProvider {
  get name() {
    return PROVIDER_NAME;
  }

  get type() {
    return lazy.UrlbarShared.PROVIDER_TYPE.PROFILE;
  }

  async isActive(queryContext) {
    return (
      lazy.enabled &&
      !queryContext.searchMode &&
      !!matchOmniTool(queryContext.searchString)
    );
  }

  getViewTemplate() {
    return VIEW_TEMPLATE;
  }

  getViewUpdate(result) {
    const label = lazy.l10n.formatValueSync(
      `peppermint-omni-kind-${result.payload.kind}`
    );
    return {
      label: { textContent: label ? `${label}: ` : "" },
      output: { textContent: result.payload.display },
      action: { l10n: { id: "urlbar-result-action-copy-to-clipboard" } },
    };
  }

  async startQuery(queryContext, addCallback) {
    const answers = await omniResults(queryContext.searchString);
    answers.forEach(({ kind, value }, index) => {
      addCallback(
        this,
        new lazy.UrlbarResult({
          type: lazy.UrlbarShared.RESULT_TYPE.DYNAMIC,
          source: lazy.UrlbarShared.RESULT_SOURCE.OTHER_LOCAL,
          suggestedIndex: index + 1,
          payload: {
            dynamicType: DYNAMIC_RESULT_TYPE,
            kind,
            value,
            display: displayValue(value),
          },
        })
      );
    });
  }

  onEngagement(queryContext, controller, details) {
    lazy.ClipboardHelper.copyString(details.result.payload.value);
    const window = details.element?.documentGlobal;
    if (window) {
      showToast(window, "peppermint-omni-copied");
    }
  }
}

export function registerOmniUtilsProvider() {
  const manager = ProvidersManager.getInstanceForSap("urlbar");
  if (!manager.getProvider(PROVIDER_NAME)) {
    manager.registerProvider(new PeppermintUrlbarProviderOmniUtils());
  }
}
