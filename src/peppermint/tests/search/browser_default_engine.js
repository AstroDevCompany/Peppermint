/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { SearchService } = ChromeUtils.importESModule(
  "moz-src:///toolkit/components/search/SearchService.sys.mjs"
);
const { PeppermintSearch } = ChromeUtils.importESModule(
  "moz-src:///peppermint/search/PeppermintSearch.sys.mjs"
);
const { SearchUtils } = ChromeUtils.importESModule(
  "moz-src:///toolkit/components/search/SearchUtils.sys.mjs"
);

// Mintch must be the default search engine of a fresh profile, for normal and
// private windows, and must be the first engine offered. It is added at startup
// so a search config update from remote settings cannot drop it.

add_task(async function test_mintch_is_default() {
  await PeppermintSearch.init();

  let engine = await SearchService.getDefault();
  Assert.equal(engine.name, "Mintch", "Mintch is the default engine");

  let privateEngine = await SearchService.getDefaultPrivate();
  Assert.equal(
    privateEngine.name,
    "Mintch",
    "Mintch is the default private engine"
  );

  let engines = await SearchService.getVisibleEngines();
  Assert.equal(engines[0].name, "Mintch", "Mintch is listed first");
});

add_task(async function test_mintch_urls() {
  let engine = await SearchService.getDefault();

  let search = engine.getSubmission("peppermint browser");
  let url = new URL(search.uri.spec);
  Assert.equal(url.pathname, "/search", "Search goes to /search");
  Assert.equal(url.searchParams.get("q"), "peppermint browser", "Query is q");

  let suggestions = engine.getSubmission(
    "pepper",
    SearchUtils.URL_TYPE.SUGGEST_JSON
  );
  Assert.equal(
    new URL(suggestions.uri.spec).pathname,
    "/autocompleter",
    "Suggestions use the SearXNG autocompleter"
  );
});

add_task(async function test_mintch_survives_config_reload() {
  let engine = SearchService.getEngineByName("Mintch");
  Assert.ok(engine, "Mintch exists");
  Assert.ok(!engine.isAppProvided, "Mintch is a user engine, not config based");
});
