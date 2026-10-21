/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// The wall tests wait out the seconds the retries get.
requestLongerTimeout(4);

// Offline: the lists are seeded into the profile as if they had just been
// downloaded, so the blocker has nothing to fetch.

const { HttpServer } = ChromeUtils.importESModule(
  "resource://testing-common/httpd.sys.mjs"
);
const { gZenAdblock } = ChromeUtils.importESModule(
  "resource:///modules/zen/adblock/ZenAdblockManager.sys.mjs"
);
const { VIDEO_PAGE_HOOK } = ChromeUtils.importESModule(
  "resource:///modules/zen/adblock/ZenAdblockVideo.sys.mjs"
);
const { LIST_URLS, RESOURCES_URL, hashString } = ChromeUtils.importESModule(
  "resource:///modules/zen/adblock/ZenAdblockLists.sys.mjs"
);

// Whatever the first inline script of a page sees is what a site's own
// anti-adblock code sees. Scriptlets that rewrite inline scripts or freeze
// APIs only work when they have already run by then.
const PAGE = `<!DOCTYPE html><html><head>
  <script>
    window.seenByFirstScript = typeof window.zenEarlyMarker;
  </script>
</head><body></body></html>`;

const RULES = "localhost##+js(zen-test-marker)";

// A scriptlet that does nothing but leave a mark on the page.
const RESOURCES = JSON.stringify({
  scriptlets: [
    {
      name: "zen-test-marker.js",
      aliases: [],
      body: "function () { window.zenEarlyMarker = 1; }",
      dependencies: [],
    },
  ],
  redirects: [],
});

async function seedLists() {
  const dir = PathUtils.join(PathUtils.profileDir, "zen-adblock");
  await IOUtils.makeDirectory(PathUtils.join(dir, "lists"), {
    ignoreExisting: true,
  });
  const meta = {};
  const texts = new Map(
    [...LIST_URLS.medium].map(url => [url, "! seeded by the test\n"])
  );
  texts.set(RESOURCES_URL, RESOURCES);
  for (const [url, text] of texts) {
    await IOUtils.writeUTF8(
      PathUtils.join(dir, "lists", `${hashString(url)}.txt`),
      text
    );
    meta[url] = {
      hash: hashString(text),
      size: text.length,
      etag: "",
      lastModified: "",
      // Recent enough that nothing is asked of the network.
      checkedAt: Date.now(),
    };
  }
  await IOUtils.writeJSON(PathUtils.join(dir, "lists.json"), meta);
}

let server;

add_setup(async function () {
  await seedLists();
  server = new HttpServer();
  server.registerPathHandler("/", (request, response) => {
    response.setHeader("Content-Type", "text/html", false);
    response.write(PAGE);
  });
  server.start(-1);
  registerCleanupFunction(async () => {
    Services.prefs.clearUserPref("zen.adblock.customRules");
    Services.prefs.clearUserPref("zen.adblock.early-script-hosts");
    await new Promise(resolve => server.stop(resolve));
  });
});

function pageUrl() {
  return `http://localhost:${server.identity.primaryPort}/`;
}

async function useRules() {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["zen.adblock.enabled", true],
      ["zen.adblock.level", "medium"],
    ],
  });
  Services.prefs.setStringPref("zen.adblock.customRules", RULES);
  await TestUtils.waitForCondition(
    () =>
      gZenAdblock
        .getCosmetics({ url: pageUrl(), hostnameOnly: true })
        .scripts?.some(script => script.includes("zenEarlyMarker")),
    "the medium engine has the test scriptlet",
    250,
    80
  );
}

async function firstScriptSaw() {
  return BrowserTestUtils.withNewTab(pageUrl(), browser =>
    SpecialPowers.spawn(browser, [], () => content.wrappedJSObject.seenByFirstScript)
  );
}

add_task(async function test_published_hosts_get_scriptlets_before_the_page() {
  await useRules();
  Services.prefs.setStringPref("zen.adblock.early-script-hosts", "localhost");
  await TestUtils.waitForCondition(
    () => gZenAdblock.hasEarlyScripts("localhost"),
    "the scriptlets for the host are published to content processes",
    100,
    100
  );
  // Compiling in the content processes is idle work that trails the publish.
  await new Promise(resolve => setTimeout(resolve, 2000));
  // Every load gets a fresh content process here; the scripts are compiled
  // while it starts, so none of them has to wait for the page.
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    Assert.equal(
      await firstScriptSaw(),
      "number",
      `the scriptlet ran before the first inline script (load ${i + 1})`
    );
  }
});

add_task(async function test_other_hosts_still_get_scriptlets() {
  Services.prefs.setStringPref("zen.adblock.early-script-hosts", "");
  await TestUtils.waitForCondition(
    () => !gZenAdblock.hasEarlyScripts("localhost"),
    "nothing is published for the host any more",
    100,
    100
  );
  info(
    `through the page query alone the first script saw: ${await firstScriptSaw()}`
  );
  const browserSaw = await BrowserTestUtils.withNewTab(pageUrl(), async browser => {
    await TestUtils.waitForCondition(
      () =>
        SpecialPowers.spawn(
          browser,
          [],
          () => content.wrappedJSObject.zenEarlyMarker === 1
        ),
      "the scriptlet still reaches the page through the normal query"
    );
    return true;
  });
  Assert.ok(browserSaw, "the regular path keeps working for unlisted hosts");
});

add_task(async function test_paused_site_is_not_published() {
  Services.prefs.setStringPref("zen.adblock.early-script-hosts", "localhost");
  await TestUtils.waitForCondition(
    () => gZenAdblock.hasEarlyScripts("localhost"),
    "published again"
  );
  gZenAdblock.setOverride(pageUrl(), "off");
  await TestUtils.waitForCondition(
    () => !gZenAdblock.hasEarlyScripts("localhost"),
    "a paused site is withdrawn from the published table"
  );
  Assert.equal(
    await firstScriptSaw(),
    "undefined",
    "no scriptlet runs on a paused site"
  );
  gZenAdblock.removeOverrideForSite("localhost");
});

// A player that answers with the "ad blockers violate the Terms of Service"
// screen, as some accounts get it, under a status the lists do not retry on.
async function runEnforcementPage(status) {
  // The page must not be one the blocker pauses itself on (see below).
  Services.prefs.setStringPref("zen.adblock.early-script-hosts", "");
  await TestUtils.waitForCondition(
    () => !gZenAdblock.hasEarlyScripts("localhost"),
    "nothing is published for the host"
  );
  return BrowserTestUtils.withNewTab(pageUrl(), async browser => {
    await SpecialPowers.spawn(browser, [VIDEO_PAGE_HOOK, status], (hook, initial) => {
      content.eval(`
        window.ytcfg = { data_: { INNERTUBE_CONTEXT: { client: {
          userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:1.0) Gecko/1 Firefox/1.0",
        } } } };
        window.loads = [];
        window.wallEvents = 0;
        window.addEventListener("zen-adblock-wall", () => window.wallEvents++);
        window.nextStatus = ${JSON.stringify(initial)};
        const player = document.createElement("div");
        player.id = "movie_player";
        player.getPlayerResponse = () => ({
          playabilityStatus: window.nextStatus,
          videoDetails: { videoId: "abc" },
          playerConfig: { playbackStartConfig: { startSeconds: 7 } },
        });
        player.loadVideoById = (id, start) => {
          window.loads.push(id + "@" + start + " " + window.ytcfg.data_.INNERTUBE_CONTEXT.client.userAgent);
          // The retry is answered with the same screen, as a fresh response.
          window.nextStatus = JSON.parse(JSON.stringify(window.nextStatus));
        };
        document.body.appendChild(player);
      `);
      content.eval(hook);
    });
    // Each pass of the retry runs once a second.
    await new Promise(resolve => setTimeout(resolve, 6500));
    return SpecialPowers.spawn(browser, [], () => ({
      loads: Array.from(content.wrappedJSObject.loads),
      agent: content.wrappedJSObject.ytcfg.data_.INNERTUBE_CONTEXT.client.userAgent,
      wallEvents: content.wrappedJSObject.wallEvents,
    }));
  });
}

const ENFORCED = {
  status: "ERROR",
  errorScreen: { enforcementMessageViewModel: { isVisible: true } },
};

add_task(async function test_enforcement_screen_is_retried_with_each_marker_once() {
  const { loads, agent, wallEvents } = await runEnforcementPage(ENFORCED);
  Assert.equal(wallEvents, 1, "the page is told once that the retries ran out");
  Assert.deepEqual(
    loads.map(entry => entry.match(/rv:1.0; (\w+)\)/)?.[1]),
    ["lactmilli", "inline", "yahi", "channel"],
    "the video is loaded again once per marker, in order"
  );
  Assert.ok(loads.every(entry => entry.startsWith("abc@7 ")), "same video and position");
  Assert.ok(
    !/lactmilli|inline|yahi|channel/.test(agent),
    "once every marker has failed the client is left as it was"
  );
});

add_task(async function test_other_player_states_are_left_alone() {
  for (const status of [
    { status: "OK" },
    // The list's own retry handles this one.
    { status: "UNPLAYABLE", errorScreen: { enforcementMessageViewModel: {} } },
    { status: "ERROR", errorScreen: { playerErrorMessageRenderer: {} } },
  ]) {
    const { loads } = await runEnforcementPage(status);
    Assert.deepEqual(loads, [], `no retry for ${JSON.stringify(status)}`);
  }
});

// The wall is looked for on YouTube and on the hosts that have scripts
// published, which is how a local page stands in for YouTube here.
const WALL_PAGE = `<!DOCTYPE html><html><body>
  <ytd-enforcement-message-view-model>Ad blockers violate YouTube's Terms of Service</ytd-enforcement-message-view-model>
</body></html>`;

async function loadWallPage({ expectReload }) {
  const wallServer = new HttpServer();
  let requests = 0;
  wallServer.registerPathHandler("/watch", (request, response) => {
    requests++;
    response.setHeader("Content-Type", "text/html", false);
    response.write(WALL_PAGE);
  });
  wallServer.start(-1);
  const url = `http://localhost:${wallServer.identity.primaryPort}/watch?v=abc`;
  await useRules();
  Services.prefs.setStringPref("zen.adblock.early-script-hosts", "localhost");
  await TestUtils.waitForCondition(
    () => gZenAdblock.hasEarlyScripts("localhost"),
    "the host is published"
  );
  await new Promise(resolve => setTimeout(resolve, 1000));
  let result;
  await BrowserTestUtils.withNewTab(url, async browser => {
    // The retries get a few seconds before blocking is paused.
    if (expectReload) {
      await TestUtils.waitForCondition(() => requests >= 2, "the page is reloaded", 500, 80);
    } else {
      await new Promise(resolve => setTimeout(resolve, 12000));
    }
    await new Promise(resolve => setTimeout(resolve, 3000));
    result = {
      requests,
      allowed: gZenAdblock.isTabAllowed(browser, url),
      stored: await SpecialPowers.spawn(browser, [], () =>
        content.sessionStorage.getItem("zen-adblock-allowed")
      ),
    };
  });
  await new Promise(resolve => wallServer.stop(resolve));
  return result;
}

add_task(async function test_a_wall_that_stays_pauses_blocking_for_the_tab() {
  const { requests, allowed, stored } = await loadWallPage({ expectReload: true });
  Assert.equal(requests, 2, "the page is loaded once more, and only once");
  Assert.ok(allowed, "blocking is paused for the site in that tab");
  Assert.equal(stored, "1", "the tab remembers it for the reload and later pages");
});

add_task(async function test_the_fallback_can_be_turned_off() {
  Services.prefs.setBoolPref("zen.adblock.youtube-wall-fallback", false);
  registerCleanupFunction(() =>
    Services.prefs.clearUserPref("zen.adblock.youtube-wall-fallback")
  );
  const { requests, allowed } = await loadWallPage({ expectReload: false });
  Assert.equal(requests, 1, "the page is not reloaded");
  Assert.ok(!allowed, "blocking stays on");
  Services.prefs.clearUserPref("zen.adblock.youtube-wall-fallback");
});
