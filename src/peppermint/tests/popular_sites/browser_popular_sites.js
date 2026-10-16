/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

ChromeUtils.defineESModuleGetters(this, {
  matchPopularSites:
    "moz-src:///peppermint/urlbar/PeppermintUrlbarProviderPopularSites.sys.mjs",
  popularSitesQuery:
    "moz-src:///peppermint/urlbar/PeppermintUrlbarProviderPopularSites.sys.mjs",
  UrlbarTestUtils: "resource://testing-common/UrlbarTestUtils.sys.mjs",
});

const PROVIDER = "PeppermintUrlbarProviderPopularSites";

async function popularSiteUrls(value) {
  await UrlbarTestUtils.promiseAutocompleteResultPopup({
    window,
    waitForFocus,
    value,
  });
  let urls = [];
  for (let i = 0; i < UrlbarTestUtils.getResultCount(window); i++) {
    let { result } = await UrlbarTestUtils.getDetailsOfResultAt(window, i);
    if (result.providerName == PROVIDER) {
      urls.push(result.payload.url);
    }
  }
  await UrlbarTestUtils.promisePopupClose(window);
  return urls;
}

add_task(function test_query_normalization() {
  Assert.equal(popularSitesQuery("yout"), "yout");
  Assert.equal(popularSitesQuery("https://www.yout"), "yout");
  Assert.equal(popularSitesQuery("youtube.c"), "youtube.c");
  Assert.equal(popularSitesQuery("two words"), null);
  Assert.equal(popularSitesQuery("youtube.com/watch"), null);
  Assert.equal(popularSitesQuery("@google"), null);
});

add_task(function test_matching() {
  let sites = ["google.com", "google.de", "goodreads.com", "youtube.com"].map(
    domain => ({ domain, label: domain.split(".")[0] })
  );
  Assert.deepEqual(matchPopularSites(sites, "goo", 3), [
    "google.com",
    "goodreads.com",
  ]);
  Assert.deepEqual(matchPopularSites(sites, "youtube.c", 3), ["youtube.com"]);
  Assert.deepEqual(matchPopularSites(sites, "tube", 3), []);
  Assert.deepEqual(matchPopularSites(sites, "goo", 1), ["google.com"]);
});

add_task(async function test_suggests_unvisited_sites() {
  await PlacesUtils.history.clear();
  Assert.ok(
    (await popularSiteUrls("yout")).includes("https://youtube.com/"),
    "A prefix of a popular name suggests the site"
  );
  Assert.ok(
    (await popularSiteUrls("youtube.c")).includes("https://youtube.com/"),
    "A prefix of a popular domain suggests the site"
  );
  Assert.deepEqual(
    await popularSiteUrls("yout be"),
    [],
    "Several words are a search, not a site"
  );
});

add_task(async function test_prefs() {
  await SpecialPowers.pushPrefEnv({
    set: [["peppermint.urlbar.popular-sites.enabled", false]],
  });
  Assert.deepEqual(await popularSiteUrls("yout"), [], "Can be turned off");
  await SpecialPowers.popPrefEnv();

  await SpecialPowers.pushPrefEnv({
    set: [["peppermint.urlbar.popular-sites.max-results", 1]],
  });
  Assert.lessOrEqual((await popularSiteUrls("goo")).length, 1);
  await SpecialPowers.popPrefEnv();
});
