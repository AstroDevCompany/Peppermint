/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// Offline: the lists are seeded into the profile as if they had just been
// downloaded, so the blocker has nothing to fetch.

const { HttpServer } = ChromeUtils.importESModule(
  "resource://testing-common/httpd.sys.mjs"
);
const { gZenAdblock } = ChromeUtils.importESModule(
  "resource:///modules/zen/adblock/ZenAdblockManager.sys.mjs"
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
