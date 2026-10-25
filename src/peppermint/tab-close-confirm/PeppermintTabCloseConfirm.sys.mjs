/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Asks before a tab is closed from the tab's close button, and optionally
 * from a middle click on the tab. The dialog is the window-modal one the
 * quit confirmation uses, with "Close" as its default button so Enter
 * confirms.
 */

const PREFS = {
  confirmButton: "peppermint.tabs.confirm-close-button",
  confirmMiddleClick: "peppermint.tabs.confirm-close-middle-click",
};

const lazy = {};
ChromeUtils.defineLazyGetter(
  lazy,
  "l10n",
  () => new Localization(["browser/peppermint-tab-close.ftl"], true)
);

export const PeppermintTabCloseConfirm = {
  /**
   * @param {"button"|"middle-click"} source How the close was requested
   * @returns {boolean} Whether a confirmation applies to that source
   */
  isEnabled(source) {
    if (!Services.prefs.getBoolPref(PREFS.confirmButton, false)) {
      return false;
    }
    return (
      source !== "middle-click" ||
      Services.prefs.getBoolPref(PREFS.confirmMiddleClick, false)
    );
  },

  /**
   * Shows the dialog when the setting for this source asks for it.
   *
   * @param {Window} window The browser window that owns the tabs
   * @param {"button"|"middle-click"} source How the close was requested
   * @param {number} [tabCount] How many tabs are about to close
   * @returns {boolean} Whether the tabs may be closed
   */
  confirm(window, source, tabCount = 1) {
    if (!this.isEnabled(source)) {
      return true;
    }
    const [title, closeLabel] = lazy.l10n.formatValuesSync([
      { id: "peppermint-tab-close-title", args: { tabCount } },
      { id: "peppermint-tab-close-button", args: { tabCount } },
    ]);
    const flags =
      Services.prompt.BUTTON_POS_0_DEFAULT |
      (Services.prompt.BUTTON_TITLE_IS_STRING * Services.prompt.BUTTON_POS_0) |
      (Services.prompt.BUTTON_TITLE_CANCEL * Services.prompt.BUTTON_POS_1);
    const buttonPressed = Services.prompt.confirmEx(
      window,
      title,
      null,
      flags,
      closeLabel,
      null,
      null,
      null,
      {}
    );
    return buttonPressed === 0;
  },
};
