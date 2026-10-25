// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { Preferences } from "chrome://global/content/preferences/Preferences.mjs";
import { SettingGroupManager } from "chrome://browser/content/preferences/config/SettingGroupManager.mjs";
import "chrome://browser/content/preferences/widgets/peppermint-about.mjs";

const { AppConstants } = ChromeUtils.importESModule(
  "resource://gre/modules/AppConstants.sys.mjs"
);

Preferences.addSetting({
  id: "peppermintAboutInfo",
  getControlConfig(config) {
    config.controlAttrs = {
      ".version": AppConstants.MOZ_APP_VERSION_DISPLAY,
    };
    return config;
  },
});

SettingGroupManager.registerGroups({
  peppermintAbout: {
    l10nId: "peppermint-about-heading",
    headingLevel: 2,
    items: [
      {
        id: "peppermintAboutInfo",
        control: "peppermint-about",
      },
    ],
  },
});
