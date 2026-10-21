/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const {
  cosmeticQueryOptions,
  decideNetworkRequest,
  dedupeScriptlets,
  levelScansDom,
  parseFilterList,
  shouldInspectNetworkRequest,
} = ChromeUtils.importESModule(
  "resource:///modules/zen/adblock/ZenAdblockPolicy.sys.mjs"
);
const {
  isVideoAdRequest,
  isYouTubeHost,
  rewriteVideoAdBody,
  shouldRewriteVideoAdResponse,
} = ChromeUtils.importESModule(
  "resource:///modules/zen/adblock/ZenAdblockVideo.sys.mjs"
);
const { cacheNeedsRefresh, fetchFilterLists, gZenAdblock } =
  ChromeUtils.importESModule(
    "resource:///modules/zen/adblock/ZenAdblockManager.sys.mjs"
  );

const FIXTURE = [
  "||ads.example^",
  "@@||ads.example/allowed.js^",
  "news.example##.ad-slot",
].join("\n");

add_task(function test_filter_decisions() {
  const engine = parseFilterList(FIXTURE, "medium");

  const blocked = decideNetworkRequest({
    engine,
    level: "medium",
    url: "https://ads.example/banner.js",
    sourceUrl: "https://news.example/",
    type: "script",
  });
  Assert.equal(blocked.action, "cancel", "a listed ad script is blocked");

  const allowed = decideNetworkRequest({
    engine,
    level: "medium",
    url: "https://ads.example/allowed.js",
    sourceUrl: "https://news.example/",
    type: "script",
  });
  Assert.equal(allowed.action, "allow", "an exception filter allows the request");

  const heavy = decideNetworkRequest({
    engine,
    level: "heavy",
    url: "https://cdn.example/app.js",
    sourceUrl: "https://news.example/",
    type: "script",
  });
  Assert.equal(heavy.action, "cancel", "heavy blocks an unlisted third-party script");
  Assert.equal(heavy.reason, "heavy");

  const heavyException = decideNetworkRequest({
    engine,
    level: "heavy",
    url: "https://ads.example/allowed.js",
    sourceUrl: "https://news.example/",
    type: "script",
  });
  Assert.equal(
    heavyException.action,
    "allow",
    "an exception filter still allows a third-party script on Heavy"
  );

  const firstParty = decideNetworkRequest({
    engine,
    level: "heavy",
    url: "https://news.example/app.js",
    sourceUrl: "https://news.example/",
    type: "script",
  });
  Assert.equal(firstParty.action, "allow", "heavy still allows first-party scripts");

  const paused = decideNetworkRequest({
    engine,
    level: "off",
    url: "https://ads.example/banner.js",
    sourceUrl: "https://news.example/",
    type: "script",
  });
  Assert.equal(paused.action, "allow", "per-site off skips filtering");

  const cosmetics = engine.getCosmeticsFilters({
    url: "https://news.example/",
    hostname: "news.example",
    domain: "news.example",
    classes: ["ad-slot"],
    ids: [],
    hrefs: [],
    getInjectionRules: false,
    getExtendedRules: false,
    getBaseRules: true,
  });
  ok(
    cosmetics.styles.includes(".ad-slot"),
    "cosmetic filters hide the listed slot"
  );
});

add_task(function test_bootstrap_list_before_engine_is_ready() {
  const blocked = decideNetworkRequest({
    engine: null,
    level: "medium",
    url: "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js",
    sourceUrl: "https://news.example/",
    type: "script",
  });
  Assert.equal(blocked.action, "cancel");
  Assert.equal(blocked.reason, "bootstrap");

  const allowed = decideNetworkRequest({
    engine: null,
    level: "medium",
    url: "https://news.example/app.js",
    sourceUrl: "https://news.example/",
    type: "script",
  });
  Assert.equal(allowed.action, "allow");
});

add_task(function test_video_ad_requests_and_player_payloads() {
  const pagead = decideNetworkRequest({
    engine: null,
    level: "medium",
    url: "https://www.youtube.com/pagead/interaction",
    sourceUrl: "https://www.youtube.com/watch?v=abc",
    type: "xmlhttprequest",
  });
  Assert.equal(pagead.action, "cancel");
  Assert.equal(pagead.reason, "video-ad");

  const playback = decideNetworkRequest({
    engine: null,
    level: "medium",
    url: "https://rr3---sn.googlevideo.com/videoplayback?id=1",
    sourceUrl: "https://www.youtube.com/watch?v=abc",
    type: "media",
  });
  Assert.equal(playback.action, "allow", "video playback is not treated as an ad");

  const ima = decideNetworkRequest({
    engine: null,
    level: "light",
    url: "https://imasdk.googleapis.com/js/sdkloader/ima3.js",
    sourceUrl: "https://news.example/",
    type: "script",
  });
  Assert.equal(ima.action, "cancel");
  Assert.equal(ima.reason, "video-ad");

  ok(isVideoAdRequest("https://www.youtube.com/api/stats/ads?ver=2"));
  ok(!isVideoAdRequest("https://www.youtube.com/watch?v=abc"));
  ok(
    shouldRewriteVideoAdResponse(
      "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
      "application/json"
    )
  );
  ok(
    !shouldRewriteVideoAdResponse(
      "https://www.youtube.com/watch?v=abc",
      "text/html"
    ),
    "the watch document is left intact so player code keeps its property names"
  );
  Assert.equal(
    rewriteVideoAdBody('{"adPlacements":[],"adSlots":[],"playerAds":{}}'),
    '{"no_ads":[],"no_ads":[],"no_ads":{}}'
  );

  const paused = decideNetworkRequest({
    engine: null,
    level: "off",
    url: "https://www.youtube.com/pagead/interaction",
    sourceUrl: "https://www.youtube.com/watch?v=abc",
    type: "xmlhttprequest",
  });
  Assert.equal(paused.action, "allow", "per-site off still allows video ad URLs");
});

add_task(function test_per_site_override_uses_base_domain() {
  const url = "https://www.example.com/article";
  gZenAdblock.setOverride(url, "off");
  Assert.equal(gZenAdblock.getOverride("https://example.com/"), "off");
  Assert.equal(gZenAdblock.getEffectiveLevel(url), "off");

  gZenAdblock.setOverride(url, "heavy");
  Assert.equal(gZenAdblock.getEffectiveLevel("https://example.com/other"), "heavy");

  gZenAdblock.setOverride(url, null);
  Assert.equal(gZenAdblock.getOverride(url), null);
  Assert.equal(
    gZenAdblock.getEffectiveLevel(url),
    gZenAdblock.getGlobalLevel(),
    "clearing the override falls back to the global level"
  );
});

add_task(function test_network_hot_path_skips_cheap_requests() {
  Assert.equal(
    shouldInspectNetworkRequest({
      type: "main_frame",
      isSystem: false,
      requestHost: "example.com",
      sourceHost: "",
    }),
    false,
    "top-level documents skip the filter engine"
  );
  Assert.equal(
    shouldInspectNetworkRequest({
      type: "image",
      isSystem: true,
      requestHost: "example.com",
      sourceHost: "example.com",
    }),
    false,
    "system-triggered loads skip the filter engine"
  );
  Assert.equal(
    shouldInspectNetworkRequest({
      type: "image",
      isSystem: false,
      requestHost: "news.example",
      sourceHost: "news.example",
    }),
    false,
    "first-party images skip the filter engine"
  );
  Assert.equal(
    shouldInspectNetworkRequest({
      type: "script",
      isSystem: false,
      requestHost: "news.example",
      sourceHost: "news.example",
    }),
    true,
    "first-party scripts are still inspected"
  );
  Assert.equal(
    shouldInspectNetworkRequest({
      type: "script",
      isSystem: false,
      requestHost: "ads.example",
      sourceHost: "news.example",
    }),
    true,
    "third-party scripts are inspected"
  );
});

add_task(function test_partial_list_cache_retries_after_an_hour() {
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  const interval = 4 * 24 * hour;
  Assert.equal(
    cacheNeedsRefresh({ updatedAt: now - hour }, now, interval),
    false,
    "a cache with no complete field waits out the normal interval"
  );
  Assert.equal(
    cacheNeedsRefresh({ updatedAt: now - hour, complete: false }, now, interval),
    false,
    "a partial cache is kept for the first hour"
  );
  Assert.equal(
    cacheNeedsRefresh(
      { updatedAt: now - hour - 1, complete: false },
      now,
      interval
    ),
    true,
    "a partial cache retries after an hour"
  );
  Assert.equal(
    cacheNeedsRefresh({ updatedAt: now - 5 * 24 * hour, complete: true }, now, interval),
    true,
    "a complete cache refreshes after the update interval"
  );
});

add_task(async function test_filter_lists_download_together() {
  let started = 0;
  let release;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  const pending = fetchFilterLists(["a", "b", "c"], async url => {
    started++;
    await gate;
    if (url === "b") {
      throw new Error("missing");
    }
    return `list ${url}`;
  });
  await TestUtils.waitForCondition(
    () => started === 3,
    "every list download starts before the first one finishes"
  );
  release();
  const result = await pending;
  Assert.equal(result.complete, false, "a failed list marks the cache incomplete");
  Assert.deepEqual(result.texts, ["list a", "list c"], "successful lists keep their order");
});

const { CHECK_INTERVAL_MS, listsFingerprint, nextCheckDelay, refreshLists } =
  ChromeUtils.importESModule(
    "resource:///modules/zen/adblock/ZenAdblockListCache.sys.mjs"
  );

const HOUR = 60 * 60 * 1000;

add_task(function test_update_check_delay_backs_off() {
  Assert.equal(nextCheckDelay(0), CHECK_INTERVAL_MS, "normal interval");
  Assert.equal(nextCheckDelay(1), HOUR, "first failure retries in an hour");
  Assert.equal(nextCheckDelay(2), 2 * HOUR, "then twice as long");
  Assert.equal(nextCheckDelay(3), 4 * HOUR);
  Assert.equal(nextCheckDelay(20), 24 * HOUR, "never longer than a day");
});

function listHarness(responses) {
  const stored = new Map();
  const requests = [];
  return {
    stored,
    requests,
    options: {
      fetchList: async (url, known) => {
        requests.push({ url, known });
        const response = responses[url];
        if (response instanceof Error) {
          throw response;
        }
        return typeof response === "function" ? response(known) : response;
      },
      storeText: async (url, text) => {
        stored.set(url, text);
      },
    },
  };
}

add_task(async function test_lists_use_conditional_requests() {
  const A = "https://lists.example/a.txt";
  const B = "https://lists.example/b.txt";
  const RES = "https://lists.example/resources.json";
  const harness = listHarness({
    [A]: { text: "||a.example^", etag: '"a1"' },
    [B]: { text: "||b.example^", lastModified: "Mon, 01 Jan 2026 00:00:00 GMT" },
    [RES]: { text: "[]" },
  });

  let first = await refreshLists([A, B, RES], {
    ...harness.options,
    meta: {},
    optional: [RES],
    now: 1000,
  });
  Assert.ok(first.changed, "new lists count as changed");
  Assert.ok(first.complete, "every list was loaded");
  Assert.equal(harness.stored.size, 3, "all three texts were stored");
  Assert.equal(first.meta[A].etag, '"a1"', "the validator is remembered");

  // Recently checked lists are not asked about again.
  harness.requests.length = 0;
  const soon = await refreshLists([A, B, RES], {
    ...harness.options,
    meta: first.meta,
    now: 2000,
  });
  Assert.equal(harness.requests.length, 0, "no request inside the recheck window");
  Assert.ok(!soon.changed);

  // A later check sends the validators and a 304 changes nothing.
  harness.requests.length = 0;
  harness.stored.clear();
  const notModified = {
    [A]: { notModified: true },
    [B]: { notModified: true },
    [RES]: { notModified: true },
  };
  const later = listHarness(notModified);
  const second = await refreshLists([A, B, RES], {
    ...later.options,
    meta: first.meta,
    now: 1000 + 10 * HOUR,
  });
  Assert.ok(!second.changed, "nothing changed on a 304");
  Assert.ok(second.complete);
  Assert.equal(later.stored.size, 0, "nothing was written");
  Assert.equal(
    later.requests.find(r => r.url === A).known.etag,
    '"a1"',
    "the stored ETag is sent back"
  );
  Assert.equal(
    second.meta[A].checkedAt,
    1000 + 10 * HOUR,
    "the check time moves forward"
  );
  Assert.equal(
    listsFingerprint([A, B, RES], second.meta),
    listsFingerprint([A, B, RES], first.meta),
    "the fingerprint is unchanged, so no engine is rebuilt"
  );

  // A server without validators sends the same text again: still unchanged.
  const same = listHarness({
    [A]: { text: "||a.example^" },
    [B]: { text: "||b.example^" },
    [RES]: { text: "[]" },
  });
  const third = await refreshLists([A, B, RES], {
    ...same.options,
    meta: first.meta,
    now: 1000 + 20 * HOUR,
  });
  Assert.ok(!third.changed, "identical text is not a change");
  Assert.equal(same.stored.size, 0, "identical text is not written again");

  // One list really changes.
  const changed = listHarness({
    [A]: { text: "||a.example^\n||more.example^" },
    [B]: { notModified: true },
    [RES]: { notModified: true },
  });
  const fourth = await refreshLists([A, B, RES], {
    ...changed.options,
    meta: first.meta,
    now: 1000 + 30 * HOUR,
  });
  Assert.ok(fourth.changed, "a changed list is reported");
  Assert.deepEqual([...changed.stored.keys()], [A], "only that list is stored");
  Assert.notEqual(
    listsFingerprint([A, B, RES], fourth.meta),
    listsFingerprint([A, B, RES], first.meta),
    "the fingerprint changes, so the engine is rebuilt"
  );
});

add_task(async function test_list_failures_keep_what_is_stored() {
  const A = "https://lists.example/a.txt";
  const RES = "https://lists.example/resources.json";
  const known = {
    [A]: { hash: "abc", size: 3, etag: '"a1"', checkedAt: 0 },
  };

  const required = listHarness({
    [A]: new Error("HTTP 500"),
    [RES]: { text: "[]" },
  });
  const failed = await refreshLists([A, RES], {
    ...required.options,
    meta: known,
    optional: [RES],
    now: 10 * HOUR,
  });
  Assert.ok(!failed.complete, "a failed required list is reported");
  Assert.deepEqual(failed.meta[A], known[A], "the stored copy stays in use");

  const optionalOnly = listHarness({
    [A]: { notModified: true },
    [RES]: new Error("offline"),
  });
  const partial = await refreshLists([A, RES], {
    ...optionalOnly.options,
    meta: known,
    optional: [RES],
    now: 10 * HOUR,
  });
  Assert.ok(partial.complete, "optional resources do not make the lists incomplete");
});

add_task(function test_cname_lookup_is_for_heavy_only() {
  const engine = parseFilterList(FIXTURE, "medium");
  const request = level =>
    decideNetworkRequest({
      engine,
      level,
      url: "https://cdn.example/app.js",
      sourceUrl: "https://news.example/",
      type: "image",
    });
  Assert.ok(!request("light").uncloak, "light does no lookup");
  Assert.ok(!request("medium").uncloak, "medium does no extra DNS lookups");
  Assert.ok(request("heavy").uncloak, "heavy checks the real host");
});

add_task(function test_cosmetic_queries_split_by_cost() {
  for (const level of ["light", "medium", "heavy"]) {
    const dom = cosmeticQueryOptions(level);
    Assert.ok(dom.getRulesFromDOM, `${level}: a page scan reads the DOM rules`);
    Assert.ok(
      !dom.getRulesFromHostname && !dom.getBaseRules && !dom.getInjectionRules,
      `${level}: a page scan never repeats the site's rules or scriptlets`
    );
    Assert.equal(dom.getExtendedRules, level === "heavy");

    const host = cosmeticQueryOptions(level, { hostnameOnly: true });
    Assert.ok(host.getRulesFromHostname, `${level}: the site query reads the site rules`);
    Assert.ok(!host.getRulesFromDOM, `${level}: the site query ignores the DOM`);
    Assert.equal(host.getInjectionRules, level !== "light", "light has no scriptlets");
    Assert.equal(host.getBaseRules, level !== "light");
  }
});

add_task(function test_only_levels_with_generic_filters_scan_the_page() {
  Assert.ok(!levelScansDom("light"), "light has no generic filters to find");
  Assert.ok(levelScansDom("medium"));
  Assert.ok(levelScansDom("heavy"));

  const text = ["##.ad-slot", "news.example###top-ad"].join("\n");
  const light = parseFilterList(text, "light");
  const fromDom = light.getCosmeticsFilters({
    url: "https://other.example/",
    hostname: "other.example",
    domain: "other.example",
    classes: ["ad-slot"],
    ids: [],
    hrefs: [],
    ...cosmeticQueryOptions("light"),
  });
  Assert.equal(fromDom.styles, "", "a scan at light can never match");
  const fromHost = light.getCosmeticsFilters({
    url: "https://news.example/",
    hostname: "news.example",
    domain: "news.example",
    classes: [],
    ids: [],
    hrefs: [],
    ...cosmeticQueryOptions("light", { hostnameOnly: true }),
  });
  Assert.ok(fromHost.styles.includes("#top-ad"), "site rules still apply at light");
});

add_task(function test_dom_scan_replies_carry_only_new_generic_rules() {
  const engine = parseFilterList(
    ["##.ad-slot", "news.example###top-ad"].join("\n"),
    "medium"
  );
  const query = (extra, options) =>
    engine.getCosmeticsFilters({
      url: "https://news.example/",
      hostname: "news.example",
      domain: "news.example",
      classes: [],
      ids: [],
      hrefs: [],
      ...extra,
      ...options,
    });
  const host = query({}, cosmeticQueryOptions("medium", { hostnameOnly: true }));
  Assert.ok(host.styles.includes("#top-ad"), "the site reply has the site rule");

  const scan = query({ classes: ["ad-slot"] }, cosmeticQueryOptions("medium"));
  Assert.ok(scan.styles.includes(".ad-slot"), "a scan returns the generic rule");
  Assert.ok(!scan.styles.includes("#top-ad"), "a scan does not repeat the site rule");
  Assert.equal(scan.scripts.length, 0, "a scan carries no scriptlets");
});

add_task(function test_scriptlets_are_not_injected_twice() {
  Assert.deepEqual(dedupeScriptlets(["a", "b", "a", "c", "b"]), ["a", "b", "c"]);
  Assert.deepEqual(dedupeScriptlets([]), []);
  Assert.deepEqual(dedupeScriptlets(null), []);
  const one = ["x"];
  Assert.equal(dedupeScriptlets(one), one, "a single scriptlet is passed through");
});

add_task(function test_youtube_host_check_is_exact_and_case_insensitive() {
  for (const host of [
    "youtube.com",
    "www.youtube.com",
    "WWW.YouTube.com",
    "m.youtube.com.",
    "www.youtube-nocookie.com",
    "youtubei.googleapis.com",
  ]) {
    Assert.ok(isYouTubeHost(host), `${host} is a video host`);
  }
  for (const host of ["", null, "example.com", "notyoutube.com", "youtube.com.evil.example"]) {
    Assert.ok(!isYouTubeHost(host), `${host} is not a video host`);
  }
});
