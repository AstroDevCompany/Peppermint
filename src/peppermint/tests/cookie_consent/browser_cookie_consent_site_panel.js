/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { gZenCookieConsent } = ChromeUtils.importESModule(
  "resource:///modules/zen/cookieconsent/ZenCookieConsentManager.sys.mjs"
);

add_task(async function test_site_panel_pauses_cookie_popups() {
  const tab = BrowserTestUtils.addTab(gBrowser, HTTPS_PAGE, {
    skipAnimation: true,
  });
  await BrowserTestUtils.switchTab(gBrowser, tab);
  gZenCookieConsent.init();
  gZenCookieConsent.setPaused(HTTPS_PAGE, false);

  try {
    const panel = await openSiteDataPanel();
    Assert.equal(panel.state, "open", "panel is open");
    const section = document.getElementById(
      "zen-site-data-cookie-consent-section"
    );
    ok(!section.hidden, "cookie popup section is visible on https pages");
    const state = document.getElementById(
      "zen-site-data-cookie-consent-pause-state"
    );
    Assert.equal(
      state.getAttribute("data-l10n-id"),
      "zen-site-data-cookie-consent-on",
      "cookie popups start out refusing on this site"
    );

    const pause = document.getElementById("zen-site-data-cookie-consent-pause");
    const reloaded = BrowserTestUtils.browserLoaded(gBrowser.selectedBrowser);
    EventUtils.synthesizeMouseAtCenter(pause, {});
    Assert.ok(
      gZenCookieConsent.isPaused(HTTPS_PAGE),
      "pausing stores the site"
    );
    await reloaded;

    await openSiteDataPanel();
    Assert.equal(
      document
        .getElementById("zen-site-data-cookie-consent-pause-state")
        .getAttribute("data-l10n-id"),
      "zen-site-data-cookie-consent-paused",
      "the site panel shows the pause"
    );
  } finally {
    gZenCookieConsent.setPaused(HTTPS_PAGE, false);
    await closeSiteDataPanel();
    BrowserTestUtils.removeTab(tab);
  }
});

add_task(async function test_paused_sites_can_be_listed_and_removed() {
  await gZenCookieConsent.ready;
  gZenCookieConsent.setPaused(HTTPS_PAGE, true);
  try {
    const site = Services.eTLD.getBaseDomain(Services.io.newURI(HTTPS_PAGE));
    Assert.ok(
      gZenCookieConsent.listPaused().includes(site),
      "a paused site is listed by its registrable domain"
    );
    gZenCookieConsent.unpauseSite(site);
    Assert.ok(
      !gZenCookieConsent.isPaused(HTTPS_PAGE),
      "removing the site from the list unpauses it"
    );
    Assert.ok(
      !gZenCookieConsent.listPaused().includes(site),
      "and it leaves the list"
    );
  } finally {
    gZenCookieConsent.setPaused(HTTPS_PAGE, false);
  }
});
