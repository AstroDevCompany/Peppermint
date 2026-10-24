/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  action,
  formatLabel,
  showToast,
} from "moz-src:///peppermint/palette/PeppermintPaletteAction.sys.mjs";

const ICONS = "chrome://browser/skin/zen-icons/";

/**
 * The settings the palette can change. Adding one is a line here and its
 * messages in zen-command-palette.ftl:
 *
 *   peppermint-setting-name-<id>                  its name
 *   peppermint-setting-value-<id>-<choice id>     the name of each choice
 *
 * A setting without `choices` is a boolean pref and offers whichever of
 * "Enable" and "Disable" is not already the case. One with `choices` offers
 * every choice but the current one. `requires` names a boolean pref that has
 * to be on for the setting to mean anything.
 */
export const SETTINGS = [
  // Privacy and security
  {
    id: "do-not-track",
    pref: "privacy.donottrackheader.enabled",
    icon: "tracking-protection",
  },
  {
    id: "global-privacy-control",
    pref: "privacy.globalprivacycontrol.enabled",
    icon: "tracking-protection",
  },
  { id: "https-only", pref: "dom.security.https_only_mode", icon: "security" },
  { id: "popup-blocker", pref: "dom.disable_open_during_load", icon: "popup" },
  { id: "save-passwords", pref: "signon.rememberSignons", icon: "passwords" },
  {
    id: "autofill-addresses",
    pref: "extensions.formautofill.addresses.enabled",
    icon: "passwords",
  },
  {
    id: "autofill-cards",
    pref: "extensions.formautofill.creditCards.enabled",
    icon: "passwords",
  },
  {
    id: "cookie-banner-blocker",
    pref: "zen.cookie-consent.enabled",
    icon: "cookies-fill",
  },

  // Address bar
  {
    id: "search-suggestions",
    pref: "browser.search.suggest.enabled",
    icon: "search-glass",
  },
  {
    id: "suggest-history",
    pref: "browser.urlbar.suggest.history",
    icon: "history",
  },
  {
    id: "suggest-open-tabs",
    pref: "browser.urlbar.suggest.openpage",
    icon: "tab",
  },
  {
    id: "suggest-top-sites",
    pref: "browser.urlbar.suggest.topsites",
    icon: "search-glass",
  },
  {
    id: "popular-sites",
    pref: "peppermint.urlbar.popular-sites.enabled",
    icon: "search-glass",
  },

  // General
  {
    id: "startup-page",
    pref: "browser.startup.page",
    icon: "home",
    choices: [
      { id: "homepage", value: 1 },
      { id: "previous-session", value: 3 },
    ],
  },
  { id: "warn-closing-tabs", pref: "browser.tabs.warnOnClose", icon: "tab" },
  {
    id: "downloads-panel",
    pref: "browser.download.alwaysOpenPanel",
    icon: "downloads",
  },
  { id: "smooth-scrolling", pref: "general.smoothScroll", icon: "sliders" },
  { id: "autoscroll", pref: "general.autoScroll", icon: "sliders" },
  {
    id: "find-as-you-type",
    pref: "accessibility.typeaheadfind",
    icon: "search-page",
  },
  {
    id: "picture-in-picture-button",
    pref: "media.videocontrols.picture-in-picture.video-toggle.enabled",
    icon: "window",
  },
  { id: "glance", pref: "zen.glance.enabled", icon: "sparkles" },
];

const nameOf = setting => () => ({
  name: formatLabel(`peppermint-setting-name-${setting.id}`),
});

function isLocked(setting) {
  return Services.prefs.prefIsLocked(setting.pref);
}

function readsOn(pref) {
  return Services.prefs.getBoolPref(pref, false);
}

function readChoice(setting) {
  const { pref, choices } = setting;
  return typeof choices[0].value == "number"
    ? Services.prefs.getIntPref(pref, 0)
    : Services.prefs.getCharPref(pref, "");
}

function writeChoice(setting, value) {
  if (typeof value == "number") {
    Services.prefs.setIntPref(setting.pref, value);
  } else {
    Services.prefs.setCharPref(setting.pref, value);
  }
}

function isOffered(setting) {
  return !isLocked(setting) && (!setting.requires || readsOn(setting.requires));
}

function booleanActions(setting) {
  const icon = `${ICONS}${setting.icon}.svg`;
  return [true, false].map(turnOn =>
    action(
      `setting-${setting.id}-${turnOn ? "on" : "off"}`,
      turnOn ? "peppermint-setting-enable" : "peppermint-setting-disable",
      icon,
      window => {
        Services.prefs.setBoolPref(setting.pref, turnOn);
        showToast(
          window,
          turnOn ? "peppermint-setting-is-on" : "peppermint-setting-is-off",
          nameOf(setting)()
        );
      },
      () => isOffered(setting) && readsOn(setting.pref) !== turnOn,
      nameOf(setting)
    )
  );
}

function choiceActions(setting) {
  const icon = `${ICONS}${setting.icon}.svg`;
  return setting.choices.map(choice => {
    const choiceName = () =>
      formatLabel(`peppermint-setting-value-${setting.id}-${choice.id}`);
    return action(
      `setting-${setting.id}-${choice.id}`,
      "peppermint-setting-set",
      icon,
      window => {
        writeChoice(setting, choice.value);
        showToast(window, "peppermint-setting-was-set", {
          name: nameOf(setting)().name,
          value: choiceName(),
        });
      },
      () => isOffered(setting) && readChoice(setting) !== choice.value,
      () => ({ name: nameOf(setting)().name, value: choiceName() })
    );
  });
}

/**
 * @returns {object[]} A palette entry for each way to change each setting
 */
export function settingsActions() {
  return SETTINGS.flatMap(setting =>
    setting.choices ? choiceActions(setting) : booleanActions(setting)
  );
}
