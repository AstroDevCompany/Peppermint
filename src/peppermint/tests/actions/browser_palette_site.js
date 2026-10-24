/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { registerPeppermintActions, peppermintActions } =
  ChromeUtils.importESModule(
    "moz-src:///peppermint/common/PeppermintActions.sys.mjs"
  );
const { PERMISSIONS } = ChromeUtils.importESModule(
  "moz-src:///peppermint/palette/PeppermintPaletteSite.sys.mjs"
);
const { SitePermissions } = ChromeUtils.importESModule(
  "resource:///modules/SitePermissions.sys.mjs"
);
const { gZenCookieConsent } = ChromeUtils.importESModule(
  "resource:///modules/zen/cookieconsent/ZenCookieConsentManager.sys.mjs"
);

const SITE = "https://example.com/";

function byId(id) {
  return peppermintActions().find(action => action.commandId === id);
}

add_task(function test_site_actions_have_labels() {
  registerPeppermintActions();
  const ids = [
    "peppermint:site-reset-permissions",
    "peppermint:site-manage-permissions",
    "peppermint:site-clear-data",
    "peppermint:site-cookie-banners-pause",
    "peppermint:site-cookie-banners-resume",
  ];
  for (const { id } of PERMISSIONS) {
    for (const verb of ["allow", "block", "reset"]) {
      ids.push(`peppermint:site-permission-${verb}-${id}`);
    }
  }
  for (const id of ids) {
    const entry = byId(id);
    ok(entry, `${id} exists`);
    ok(entry.label.length, `${id} has a label`);
    ok(!entry.label.includes("peppermint-"), `${id} label is translated`);
  }
});

add_task(async function test_site_actions_need_a_web_page() {
  const tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "about:blank"
  );
  for (const entry of peppermintActions()) {
    if (entry.commandId.startsWith("peppermint:site-")) {
      ok(!entry.isAvailable(window), `${entry.commandId} needs a web page`);
    }
  }
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_permission_actions_follow_the_permission() {
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, SITE);
  const principal = gBrowser.contentPrincipal;
  const allow = byId("peppermint:site-permission-allow-geo");
  const block = byId("peppermint:site-permission-block-geo");
  const reset = byId("peppermint:site-permission-reset-geo");
  const resetAll = byId("peppermint:site-reset-permissions");
  try {
    ok(allow.isAvailable(window), "Allowing is offered");
    ok(block.isAvailable(window), "Blocking is offered");
    ok(!reset.isAvailable(window), "Nothing to reset yet");

    allow.command(window);
    Assert.equal(
      SitePermissions.getForPrincipal(principal, "geo").state,
      SitePermissions.ALLOW,
      "The site is allowed"
    );
    ok(!allow.isAvailable(window), "Allowing is no longer offered");
    ok(block.isAvailable(window), "Blocking still is");
    ok(reset.isAvailable(window), "Resetting is offered");
    ok(resetAll.isAvailable(window), "Resetting everything is offered");

    block.command(window);
    Assert.equal(
      SitePermissions.getForPrincipal(principal, "geo").state,
      SitePermissions.BLOCK,
      "The site is blocked"
    );

    reset.command(window);
    Assert.equal(
      SitePermissions.getForPrincipal(principal, "geo").state,
      SitePermissions.getDefault("geo"),
      "The permission is back to its default"
    );
    ok(!reset.isAvailable(window), "Nothing left to reset");

    allow.command(window);
    byId("peppermint:site-permission-allow-camera").command(window);
    resetAll.command(window);
    ok(!resetAll.isAvailable(window), "Resetting everything leaves nothing");
    Assert.equal(
      SitePermissions.getForPrincipal(principal, "camera").state,
      SitePermissions.getDefault("camera"),
      "Every permission is back to its default"
    );
  } finally {
    SitePermissions.removeFromPrincipal(principal, "geo");
    SitePermissions.removeFromPrincipal(principal, "camera");
    BrowserTestUtils.removeTab(tab);
  }
});

add_task(async function test_cookie_banner_rule_follows_the_site() {
  gZenCookieConsent.init();
  const pause = byId("peppermint:site-cookie-banners-pause");
  const resume = byId("peppermint:site-cookie-banners-resume");
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, SITE);
  try {
    ok(pause.isAvailable(window), "Pausing is offered");
    ok(!resume.isAvailable(window), "Resuming is not");
    pause.command(window);
    ok(gZenCookieConsent.isPaused(SITE), "The site is paused");
    ok(!pause.isAvailable(window), "Pausing is no longer offered");
    ok(resume.isAvailable(window), "Resuming is");
    resume.command(window);
    ok(!gZenCookieConsent.isPaused(SITE), "The site is not paused");
  } finally {
    gZenCookieConsent.setPaused(SITE, false);
    BrowserTestUtils.removeTab(tab);
  }
});
