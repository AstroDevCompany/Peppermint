/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { HttpServer } = ChromeUtils.importESModule(
  "resource://testing-common/httpd.sys.mjs"
);
const { gZenCookieConsent } = ChromeUtils.importESModule(
  "resource:///modules/zen/cookieconsent/ZenCookieConsentManager.sys.mjs"
);

const REJECT_PAGE = `<!DOCTYPE html><html><body>
  <div id="banner" role="dialog" aria-modal="true">
    <p>We use cookies on this site.</p>
    <button id="accept" type="button">Accept all</button>
    <button id="reject" type="button">Reject all</button>
  </div>
  <script>
    document.getElementById("accept").addEventListener("click", () => {
      window.__zenAccept = 1;
    });
    document.getElementById("reject").addEventListener("click", () => {
      window.__zenReject = 1;
    });
  </script>
</body></html>`;

const ACCEPT_PAGE = `<!DOCTYPE html><html><body>
  <div id="banner" role="dialog" aria-modal="true">
    <p>We use cookies on this site.</p>
    <button id="accept" type="button">Accept all</button>
  </div>
  <script>
    document.getElementById("accept").addEventListener("click", () => {
      window.__zenAccept = 1;
    });
  </script>
</body></html>`;

// A single page app that shows its banner long after the first scans gave up.
const LATE_PAGE = `<!DOCTYPE html><html><body>
  <main id="app">Welcome</main>
  <script>
    setTimeout(() => {
      history.pushState({}, "", "/late/next");
      const banner = document.createElement("div");
      banner.id = "banner";
      banner.setAttribute("role", "dialog");
      banner.setAttribute("aria-modal", "true");
      banner.innerHTML =
        '<p>We use cookies on this site.</p>' +
        '<button id="accept" type="button">Accept all</button>' +
        '<button id="reject" type="button">Reject all</button>';
      banner.querySelector("#reject").addEventListener("click", () => {
        window.__zenReject = 1;
      });
      banner.querySelector("#accept").addEventListener("click", () => {
        window.__zenAccept = 1;
      });
      document.body.appendChild(banner);
    }, 9500);
  </script>
</body></html>`;

let server;
let base;

function writeHtml(response, request, html) {
  response.setStatusLine(request.httpVersion, 200, "OK");
  response.setHeader("Content-Type", "text/html", false);
  response.write(html);
}

async function bannerState(browser) {
  return SpecialPowers.spawn(browser, [], () => {
    const banner = content.document.getElementById("banner");
    const view = content.wrappedJSObject;
    return {
      accept: view.__zenAccept || 0,
      reject: view.__zenReject || 0,
      hidden: !banner || banner.hidden || banner.style.display === "none",
    };
  });
}

add_setup(async function () {
  server = new HttpServer();
  server.registerPathHandler("/reject", (request, response) => {
    writeHtml(response, request, REJECT_PAGE);
  });
  server.registerPathHandler("/accept", (request, response) => {
    writeHtml(response, request, ACCEPT_PAGE);
  });
  server.registerPathHandler("/late", (request, response) => {
    writeHtml(response, request, LATE_PAGE);
  });
  server.start(-1);
  base = `http://localhost:${server.identity.primaryPort}`;
  gZenCookieConsent.init();
  gZenCookieConsent.setPaused(base, false);
  registerCleanupFunction(() => {
    gZenCookieConsent.setPaused(base, false);
    return new Promise(resolve => server.stop(resolve));
  });
});

add_task(async function test_page_reject_is_clicked() {
  const tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    `${base}/reject`
  );
  try {
    await TestUtils.waitForCondition(async () => {
      const state = await bannerState(tab.linkedBrowser);
      return state.reject === 1 && state.accept === 0;
    }, "the reject control is clicked and accept is not");
    await TestUtils.waitForCondition(
      () => gZenCookieConsent.getHandledCount(tab.linkedBrowser) >= 1,
      "the handled banner is counted for the tab"
    );
  } finally {
    BrowserTestUtils.removeTab(tab);
  }
});

add_task(async function test_accept_only_banner_stays_until_it_can_be_refused() {
  const tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    `${base}/accept`
  );
  try {
    await new Promise(resolve => setTimeout(resolve, 1500));
    const state = await bannerState(tab.linkedBrowser);
    Assert.equal(state.accept, 0, "accept is not clicked");
    Assert.ok(!state.hidden, "the banner stays until a reject control exists");
  } finally {
    BrowserTestUtils.removeTab(tab);
  }
});

add_task(async function test_paused_site_keeps_the_banner() {
  gZenCookieConsent.setPaused(base, true);
  const tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    `${base}/reject`
  );
  try {
    await new Promise(resolve => setTimeout(resolve, 1500));
    const state = await bannerState(tab.linkedBrowser);
    Assert.equal(state.reject, 0, "reject is not clicked while paused");
    Assert.equal(state.accept, 0, "accept is not clicked while paused");
    Assert.ok(!state.hidden, "the banner stays visible while paused");
  } finally {
    gZenCookieConsent.setPaused(base, false);
    BrowserTestUtils.removeTab(tab);
  }
});

add_task(async function test_banner_that_appears_late_is_still_refused() {
  const before = gZenCookieConsent.handledTotal;
  const tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    `${base}/late`
  );
  try {
    await TestUtils.waitForCondition(
      async () => {
        const state = await bannerState(tab.linkedBrowser);
        return state.reject === 1 && state.accept === 0;
      },
      "the late banner is refused",
      250,
      120
    );
    Assert.equal(
      gZenCookieConsent.getHandledCount(tab.linkedBrowser),
      1,
      "the count survives the route change inside the page"
    );
    Assert.equal(
      gZenCookieConsent.handledTotal,
      before + 1,
      "the lifetime total grows"
    );
  } finally {
    BrowserTestUtils.removeTab(tab);
  }
});
