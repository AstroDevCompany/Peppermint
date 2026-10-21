/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// Needs network access: the first engine build downloads the filter lists.

const { HttpServer } = ChromeUtils.importESModule(
  "resource://testing-common/httpd.sys.mjs"
);
const { gZenAdblock } = ChromeUtils.importESModule(
  "resource:///modules/zen/adblock/ZenAdblockManager.sys.mjs"
);

const PAGE = `<!DOCTYPE html><html><body>
  <div id="zen-test-site-ad">site rule</div>
  <div id="slot"></div>
  <script>
    window.addGeneric = name => {
      const el = document.createElement("div");
      el.className = name;
      el.textContent = name;
      document.getElementById("slot").appendChild(el);
    };
    addGeneric("zen-test-generic-one");
  </script>
</body></html>`;

const RULES = [
  "localhost###zen-test-site-ad",
  "##.zen-test-generic-one",
  "##.zen-test-generic-two",
].join("\n");

let server;
let queries;
const realGetCosmetics = gZenAdblock.getCosmetics;

add_setup(async function () {
  server = new HttpServer();
  server.registerPathHandler("/", (request, response) => {
    response.setHeader("Content-Type", "text/html", false);
    response.write(PAGE);
  });
  server.start(-1);
  gZenAdblock.getCosmetics = function (data) {
    queries.push(data);
    return realGetCosmetics.call(this, data);
  };
  registerCleanupFunction(async () => {
    gZenAdblock.getCosmetics = realGetCosmetics;
    Services.prefs.clearUserPref("zen.adblock.customRules");
    await new Promise(resolve => server.stop(resolve));
  });
});

function pageUrl() {
  return `http://localhost:${server.identity.primaryPort}/`;
}

async function useLevel(level) {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["zen.adblock.enabled", true],
      ["zen.adblock.level", level],
    ],
  });
  Services.prefs.setStringPref("zen.adblock.customRules", RULES);
  // The rules are compiled into a new engine a moment after the pref changes.
  await TestUtils.waitForCondition(
    () =>
      gZenAdblock.getCosmetics({ url: pageUrl(), hostnameOnly: true }).styles
        ?.includes("zen-test-site-ad"),
    `the ${level} engine has the test rules`,
    1000,
    120
  );
}

function isHidden(browser, selector) {
  return SpecialPowers.spawn(browser, [selector], sel => {
    const el = content.document.querySelector(sel);
    return !!el && content.getComputedStyle(el).display === "none";
  });
}

async function waitHidden(browser, selector, message) {
  await TestUtils.waitForCondition(
    () => isHidden(browser, selector),
    message,
    250,
    80
  );
}

add_task(async function test_medium_adds_rules_without_touching_the_page() {
  await useLevel("medium");
  queries = [];
  await BrowserTestUtils.withNewTab(pageUrl(), async browser => {
    await waitHidden(browser, "#zen-test-site-ad", "the site rule hides the slot");
    await waitHidden(
      browser,
      ".zen-test-generic-one",
      "a generic rule found by the first scan hides its element"
    );

    await SpecialPowers.spawn(browser, [], () => {
      content.wrappedJSObject.addGeneric("zen-test-generic-two");
    });
    await waitHidden(
      browser,
      ".zen-test-generic-two",
      "a later scan hides elements added afterwards"
    );
    Assert.ok(
      await isHidden(browser, ".zen-test-generic-one"),
      "earlier matches stay hidden after a later scan"
    );
    Assert.ok(
      await isHidden(browser, "#zen-test-site-ad"),
      "the site rule stays after later scans"
    );

    const inPage = await SpecialPowers.spawn(browser, [], () => ({
      styleElements: content.document.querySelectorAll("style").length,
      byId: !!content.document.getElementById("zen-adblock-css"),
    }));
    Assert.equal(inPage.styleElements, 0, "no style element is added to the page");
    Assert.ok(!inPage.byId, "the page cannot see the blocker's styles");
  });

  const hostnameQueries = queries.filter(q => q.hostnameOnly);
  Assert.equal(hostnameQueries.length, 1, "the site is asked about once per document");
  for (const query of queries.filter(q => !q.hostnameOnly)) {
    Assert.ok(
      query.classes.length || query.ids.length || query.hrefs.length,
      "a scan is only sent when it has names to look up"
    );
  }
});

add_task(async function test_light_never_scans_the_page() {
  await useLevel("light");
  queries = [];
  await BrowserTestUtils.withNewTab(pageUrl(), async browser => {
    await waitHidden(browser, "#zen-test-site-ad", "the site rule still applies at light");
    await SpecialPowers.spawn(browser, [], () => {
      content.wrappedJSObject.addGeneric("zen-test-generic-two");
    });
    // Longer than the shortest scan interval, so a scan would have happened.
    await new Promise(resolve => setTimeout(resolve, 3000));
    Assert.ok(
      !(await isHidden(browser, ".zen-test-generic-two")),
      "light has no generic rules"
    );
  });
  Assert.deepEqual(
    queries.filter(q => !q.hostnameOnly),
    [],
    "light sends no page scans at all"
  );
});
