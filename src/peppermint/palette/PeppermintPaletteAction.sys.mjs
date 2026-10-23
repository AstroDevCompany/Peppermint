/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineLazyGetter(lazy, "l10n", () => {
  return new Localization(["browser/zen-command-palette.ftl"], true);
});

const labels = new Map();

Services.obs.addObserver(() => labels.clear(), "intl:app-locales-changed");

/**
 * The palette reads every label on every query, so what Fluent says is kept
 * until the language changes.
 *
 * @param {string} labelId - Fluent message id
 * @param {object} [args] - Fluent arguments
 * @returns {string}
 */
export function formatLabel(labelId, args) {
  const key = args ? `${labelId}|${JSON.stringify(args)}` : labelId;
  let label = labels.get(key);
  if (label === undefined) {
    label = lazy.l10n.formatValueSync(labelId, args);
    if (label) {
      labels.set(key, label);
    }
  }
  return label;
}

/**
 * One entry for Zen's command palette (see ZenUBGlobalActions).
 *
 * @param {string} id - Unique within Peppermint, used for `peppermint:<id>`
 * @param {string} labelId - Fluent message in zen-command-palette.ftl
 * @param {string} icon - Icon URL
 * @param {Function} command - Called with the window the palette is in
 * @param {Function} [isAvailable] - Whether to offer the entry in a window
 * @param {object|Function} [labelArgs] - Fluent arguments of the label, or a
 *   function returning them (for arguments that are text in the current
 *   language)
 * @returns {object}
 */
export function action(
  id,
  labelId,
  icon,
  command,
  isAvailable = () => true,
  labelArgs = undefined
) {
  return {
    commandId: `peppermint:${id}`,
    icon,
    extraPayload: {},
    isAvailable,
    command,
    get label() {
      return formatLabel(
        labelId,
        typeof labelArgs == "function" ? labelArgs() : labelArgs
      );
    },
  };
}

const FTL_FILE = "browser/zen-command-palette.ftl";

/**
 * Tells the user what a command just did, as the palette closes without any
 * other sign.
 *
 * @param {Window} window - The browser window
 * @param {string} messageId - Fluent message in zen-command-palette.ftl
 * @param {object} [l10nArgs] - Fluent arguments of the message
 */
export function showToast(window, messageId, l10nArgs) {
  try {
    window.MozXULElement.insertFTLIfNeeded(FTL_FILE);
    window.gZenUIManager
      .showToast(messageId, { l10nArgs })
      .catch(error => console.error("Palette toast failed", error));
  } catch (error) {
    console.error("Palette toast failed", error);
  }
}

/**
 * @param {nsIURI} uri
 * @returns {boolean} Whether it is an http(s) page
 */
export function isWebPage(uri) {
  return !!uri && (uri.schemeIs("http") || uri.schemeIs("https"));
}
