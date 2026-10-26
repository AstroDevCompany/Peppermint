/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Screenshots with an editor. Firefox copies or saves a selection at once and
 * shows a plain preview for the visible area and the full page. This hooks the
 * three places where a capture is turned into an image, and shows the
 * Peppermint editor (editor.html: arrows, boxes, text, a pen and redaction)
 * instead. It wraps methods of the shared ScreenshotsUtils object at run time,
 * so no Firefox file is changed; with the pref off the original methods run.
 */

import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  ScreenshotsUtils:
    "moz-src:///browser/components/screenshots/ScreenshotsUtils.sys.mjs",
});

XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "enabled",
  "peppermint.screenshot.editor.enabled",
  true
);

const EDITOR_URL = "chrome://browser/content/peppermint-screenshot/editor.html";
const LAST_SCREENSHOT_METHOD_PREF =
  "screenshots.browser.component.last-screenshot-method";

export const WRAPPED_METHODS = [
  "copyScreenshotFromRegion",
  "downloadScreenshotFromRegion",
  "takeScreenshot",
];

// What the editor window needs, handed over by a token in its address.
const sessions = new Map();

let initialized = false;

/**
 * @param {string} token - From the address of the editor
 * @returns {{blob: Blob, title: string}|null} The capture to edit; it can be
 *   taken once
 */
export function takeSession(token) {
  const session = sessions.get(token) ?? null;
  sessions.delete(token);
  return session;
}

/**
 * Show the editor over a tab.
 *
 * @param {XULElement} browser - The tab the capture is of
 * @param {Blob} blob - The capture as PNG
 * @param {string} [title] - The title of the page
 * @returns {Promise<{dialog: object, closedPromise: Promise}>}
 */
export async function openEditor(browser, blob, title = "") {
  const token = crypto.randomUUID();
  sessions.set(token, { blob, title });
  try {
    const dialogBox = browser.documentGlobal.gBrowser.getTabDialogBox(browser);
    const opened = await dialogBox.open(
      `${EDITOR_URL}?session=${token}`,
      {
        features: "resizable=no",
        sizeTo: "available",
        allowDuplicateDialogs: false,
      },
      browser
    );
    opened.closedPromise.finally(() => sessions.delete(token));
    return opened;
  } catch (error) {
    sessions.delete(token);
    throw error;
  }
}

async function editRegion(utils, region, browser, title) {
  const canvas = await utils.createCanvas(region, browser);
  const blob = await canvas.convertToBlob();
  // The Screenshots actor calls exit() as soon as this returns. Opening the
  // editor after that keeps exit() from taking the focus back from it.
  Services.tm.dispatchToMainThread(() => {
    openEditor(browser, blob, title ?? browser.contentTitle).catch(error =>
      console.error("The screenshot editor could not open", error)
    );
  });
}

async function takeAndEdit(utils, browser, type) {
  utils.closePanel(browser);
  utils.closeOverlay(browser, {
    doNotResetMethods: true,
    highlightRegions: true,
  });
  Services.focus.setFocus(browser, 0);

  const isFullPage = type === "FullPage";
  const rect = isFullPage
    ? await utils.fetchFullPageBounds(browser)
    : await utils.fetchVisibleBounds(browser);
  const lastUsedMethod = isFullPage ? "fullpage" : "visible";

  const canvas = await utils.createCanvas(rect, browser);
  const blob = await canvas.convertToBlob();
  const { dialog, closedPromise } = await openEditor(
    browser,
    blob,
    browser.contentTitle
  );
  // Like the preview it replaces: closing the editor leaves Screenshots.
  utils.setPerBrowserState(browser, {
    previewDialog: dialog,
    exitOnPreviewClose: true,
    closedPromise: closedPromise.finally(() => utils.onDialogClose(browser)),
  });

  Services.prefs.setStringPref(LAST_SCREENSHOT_METHOD_PREF, lastUsedMethod);
  utils.methodsUsed[lastUsedMethod] += 1;
  utils.recordTelemetryEvent("selected" + type);
}

const REPLACEMENTS = {
  copyScreenshotFromRegion(region, browser) {
    return editRegion(this, region, browser);
  },
  downloadScreenshotFromRegion(title, region, browser) {
    return editRegion(this, region, browser, title);
  },
  takeScreenshot(browser, type) {
    return takeAndEdit(this, browser, type);
  },
};

/**
 * Start using the editor. Safe to call from every window; it runs once.
 */
export function initScreenshotEditor() {
  if (initialized) {
    return;
  }
  const utils = lazy.ScreenshotsUtils;
  if (WRAPPED_METHODS.some(name => typeof utils[name] != "function")) {
    console.error("Screenshots changed; the screenshot editor is not used");
    return;
  }
  initialized = true;
  for (const name of WRAPPED_METHODS) {
    const original = utils[name];
    utils[name] = function (...args) {
      return lazy.enabled
        ? REPLACEMENTS[name].apply(this, args)
        : original.apply(this, args);
    };
  }
}
