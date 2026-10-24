/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  action,
  formatLabel,
  isWebPage,
  showToast,
} from "moz-src:///peppermint/palette/PeppermintPaletteAction.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  SitePermissions: "resource:///modules/SitePermissions.sys.mjs",
  SiteDataManager: "resource:///modules/SiteDataManager.sys.mjs",
  gZenCookieConsent:
    "resource:///modules/zen/cookieconsent/ZenCookieConsentManager.sys.mjs",
});

const ICONS = "chrome://browser/skin/zen-icons/";

/**
 * The permissions the palette can change for the site on screen. Each needs
 * `peppermint-permission-name-<id>` in zen-command-palette.ftl.
 */
export const PERMISSIONS = [
  { id: "camera", icon: "camera" },
  { id: "microphone", icon: "microphone" },
  { id: "geo", icon: "geo" },
  { id: "desktop-notification", icon: "desktop-notification" },
  { id: "popup", icon: "popup" },
];

function currentPrincipal(window) {
  return window.gBrowser.contentPrincipal;
}

function hasPermissionControls(window) {
  const { gBrowser } = window;
  return (
    isWebPage(gBrowser.currentURI) &&
    lazy.SitePermissions.isSupportedPrincipal(currentPrincipal(window))
  );
}

function permissionState(window, id) {
  return lazy.SitePermissions.getForPrincipal(
    currentPrincipal(window),
    id,
    window.gBrowser.selectedBrowser
  ).state;
}

// What the site has been given by the user, not the page-wide blocks Firefox
// reports alongside.
function storedPermissions(window) {
  const { SitePermissions } = lazy;
  return SitePermissions.getAllForBrowser(window.gBrowser.selectedBrowser)
    .filter(permission => permission.scope != SitePermissions.SCOPE_GLOBAL)
    .map(permission => permission.id);
}

function resetPermission(window, id) {
  lazy.SitePermissions.removeFromPrincipal(
    currentPrincipal(window),
    id,
    window.gBrowser.selectedBrowser
  );
}

function reloadPage(window) {
  try {
    window.gBrowser.selectedBrowser.reload();
  } catch {
    // The page may not be reloadable.
  }
}

function siteName(window) {
  try {
    return lazy.SiteDataManager.getBaseDomainFromHost(
      window.gBrowser.currentURI.host
    );
  } catch {
    return "";
  }
}

function permissionActions({ id, icon }) {
  const nameArgs = () => ({
    permission: formatLabel(`peppermint-permission-name-${id}`),
  });
  const iconUrl = `${ICONS}${icon}.svg`;
  const canBe = (window, state) =>
    hasPermissionControls(window) &&
    lazy.SitePermissions.getAvailableStates(id).includes(state) &&
    permissionState(window, id) !== state;
  const setTo = (window, state, toastId) => {
    lazy.SitePermissions.setForPrincipal(currentPrincipal(window), id, state);
    showToast(window, toastId, {
      ...nameArgs(),
      site: siteName(window),
    });
  };
  return [
    action(
      `site-permission-allow-${id}`,
      "peppermint-site-permission-allow",
      iconUrl,
      window =>
        setTo(
          window,
          lazy.SitePermissions.ALLOW,
          "peppermint-site-permission-allowed"
        ),
      window => canBe(window, lazy.SitePermissions.ALLOW),
      nameArgs
    ),
    action(
      `site-permission-block-${id}`,
      "peppermint-site-permission-block",
      iconUrl,
      window =>
        setTo(
          window,
          lazy.SitePermissions.BLOCK,
          "peppermint-site-permission-blocked"
        ),
      window => canBe(window, lazy.SitePermissions.BLOCK),
      nameArgs
    ),
    action(
      `site-permission-reset-${id}`,
      "peppermint-site-permission-reset",
      iconUrl,
      window => {
        resetPermission(window, id);
        showToast(window, "peppermint-site-permission-was-reset", {
          ...nameArgs(),
          site: siteName(window),
        });
      },
      window =>
        hasPermissionControls(window) && storedPermissions(window).includes(id),
      nameArgs
    ),
  ];
}

function permissionManagementActions() {
  return [
    action(
      "site-reset-permissions",
      "peppermint-site-reset-permissions",
      `${ICONS}arrow-rotate-anticlockwise.svg`,
      window => {
        for (const id of storedPermissions(window)) {
          resetPermission(window, id);
        }
        showToast(window, "peppermint-site-permissions-were-reset", {
          site: siteName(window),
        });
      },
      window =>
        hasPermissionControls(window) && !!storedPermissions(window).length
    ),
    action(
      "site-manage-permissions",
      "peppermint-site-manage-permissions",
      `${ICONS}permissions.svg`,
      window => window.BrowserCommands.pageInfo(null, "permTab"),
      window => hasPermissionControls(window)
    ),
    action(
      "site-clear-data",
      "peppermint-site-clear-data",
      `${ICONS}trash.svg`,
      window => {
        const { SiteDataManager } = lazy;
        const site = siteName(window);
        if (site && SiteDataManager.promptSiteDataRemoval(window, [site])) {
          SiteDataManager.remove(site);
        }
      },
      window => isWebPage(window.gBrowser.currentURI) && !!siteName(window)
    ),
  ];
}

function hasCookieBannerRules(window) {
  lazy.gZenCookieConsent.init();
  return (
    lazy.gZenCookieConsent.isEnabled() && isWebPage(window.gBrowser.currentURI)
  );
}

function cookieBannerActions() {
  const icon = `${ICONS}cookies-fill.svg`;
  const setPaused = (window, paused) => {
    lazy.gZenCookieConsent.setPaused(window.gBrowser.currentURI.spec, paused);
    showToast(window, "peppermint-site-rule-changed", {
      site: siteName(window),
    });
    reloadPage(window);
  };
  return [
    action(
      "site-cookie-banners-pause",
      "peppermint-site-cookie-banners-pause",
      icon,
      window => setPaused(window, true),
      window =>
        hasCookieBannerRules(window) &&
        !lazy.gZenCookieConsent.isPaused(window.gBrowser.currentURI.spec)
    ),
    action(
      "site-cookie-banners-resume",
      "peppermint-site-cookie-banners-resume",
      icon,
      window => setPaused(window, false),
      window =>
        hasCookieBannerRules(window) &&
        lazy.gZenCookieConsent.isPaused(window.gBrowser.currentURI.spec)
    ),
  ];
}

/**
 * @returns {object[]} Palette entries for the site in the tab on screen: its
 *   permissions, its stored data and the rules Peppermint keeps per site
 */
export function siteActions() {
  return [
    ...PERMISSIONS.flatMap(permissionActions),
    ...permissionManagementActions(),
    ...cookieBannerActions(),
  ];
}
