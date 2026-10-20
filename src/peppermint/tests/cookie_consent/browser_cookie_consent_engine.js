/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { inspectConsent, scoreLabel } = ChromeUtils.importESModule(
  "resource:///modules/zen/cookieconsent/ZenCookieConsentEngine.sys.mjs"
);

function page(html) {
  return new DOMParser().parseFromString(
    `<!DOCTYPE html><html><body>${html}</body></html>`,
    "text/html"
  );
}

add_task(function test_reject_labels_outrank_accept() {
  for (const label of [
    "Reject all",
    "Alle ablehnen",
    "Tout refuser",
    "Necessary only",
  ]) {
    const scores = scoreLabel(label);
    Assert.greater(
      scores.reject,
      scores.accept,
      `${label} is a reject control`
    );
  }

  const accept = scoreLabel("Accept all");
  Assert.greater(accept.accept, accept.reject, "Accept all is not a reject");
  Assert.equal(scoreLabel("OK").reject, 0, "OK is not a reject control");
  Assert.equal(scoreLabel("OK").accept, 0, "OK is not an accept control");
});

add_task(function test_reject_button_is_chosen_over_accept() {
  const doc = page(`
    <div role="dialog" aria-modal="true">
      <p>We use cookies on this site.</p>
      <button id="accept">Accept all</button>
      <button id="reject">Reject all</button>
    </div>
  `);
  const decision = inspectConsent(doc);
  Assert.equal(decision.action, "click", "a reject control is clicked");
  Assert.equal(decision.control.id, "reject", "Accept all is not the target");
});

add_task(function test_accept_only_banner_is_left_alone() {
  const doc = page(`
    <div id="banner" role="dialog" aria-modal="true">
      <p>We use cookies on this site.</p>
      <button id="accept">Accept all</button>
    </div>
  `);
  const decision = inspectConsent(doc);
  Assert.equal(decision.action, "none", "an accept-only banner is not hidden");
  Assert.ok(!decision.control, "Accept all is never clicked");
});

add_task(function test_cookie_policy_article_is_ignored() {
  const doc = page(`
    <article>
      <h1>Cookie policy</h1>
      <p>${"We use cookies to remember your preferences. ".repeat(80)}</p>
      <button>Reject all</button>
    </article>
  `);
  Assert.equal(
    inspectConsent(doc).action,
    "none",
    "a cookie policy in the page flow is left alone"
  );
});

add_task(function test_known_vendor_reject_control() {
  const doc = page(`
    <div id="onetrust-banner-sdk">
      <button id="onetrust-accept-btn-handler">Accept all</button>
      <button id="onetrust-reject-all-handler">Reject</button>
    </div>
  `);
  const decision = inspectConsent(doc);
  Assert.equal(decision.action, "click", "OneTrust is recognized");
  Assert.equal(
    decision.control.id,
    "onetrust-reject-all-handler",
    "the OneTrust reject control is used"
  );
});

add_task(function test_plain_banner_decline_is_clicked() {
  const doc = page(`
    <div class="site-notice" style="position: fixed; bottom: 0;">
      <p>We use cookies. Choose whether to accept them.</p>
      <button id="accept">Accept</button>
      <button id="decline">Decline</button>
    </div>
  `);
  const decision = inspectConsent(doc);
  Assert.equal(decision.action, "click", "a fixed banner is refused");
  Assert.equal(decision.control.id, "decline", "Decline is the control");
});

add_task(function test_plain_banner_deny_is_clicked() {
  const doc = page(`
    <div id="notice" style="position: sticky; top: 0;">
      <p>This website uses cookies.</p>
      <a id="deny" href="https://example.com/stay">Deny</a>
      <button id="accept">Allow all</button>
    </div>
  `);
  const decision = inspectConsent(doc);
  Assert.equal(decision.action, "click", "a sticky banner is refused");
  Assert.equal(decision.control.id, "deny", "Deny is the control");
});

add_task(function test_in_page_decline_is_ignored() {
  const doc = page(`
    <article>
      <p>${"We use cookies in this policy. ".repeat(40)}</p>
      <button id="decline">Decline</button>
    </article>
  `);
  Assert.equal(
    inspectConsent(doc).action,
    "none",
    "a decline button in the page flow is left alone"
  );
});

add_task(function test_subframe_decline_is_clicked() {
  const doc = page(`
    <div role="dialog">
      <p>We use cookies.</p>
      <button id="reject">Reject all</button>
    </div>
  `);
  const decision = inspectConsent(doc, { topFrame: false });
  Assert.equal(decision.action, "click", "a consent iframe is refused");
  Assert.equal(decision.control.id, "reject", "the subframe reject control is used");
});

add_task(function test_labels_in_more_languages() {
  for (const label of [
    "Отклонить все",
    "Tümünü reddet",
    "全部拒绝",
    "全部拒絕",
    "不同意",
    "すべて拒否",
    "同意しない",
    "모두 거부",
    "Απόρριψη όλων",
    "رفض الكل",
    "Összes elutasítása",
    "Tolak semua",
    "Từ chối tất cả",
    "Respinge tot",
  ]) {
    const scores = scoreLabel(label);
    Assert.greater(scores.reject, scores.accept, `${label} is a reject control`);
  }
  for (const label of [
    "Принять все",
    "Tümünü kabul et",
    "全部接受",
    "すべて同意",
    "모두 동의",
    "Αποδοχή όλων",
    "قبول الكل",
    "Terima semua",
    "Chấp nhận tất cả",
    "Összes elfogadása",
  ]) {
    const scores = scoreLabel(label);
    Assert.greater(scores.accept, scores.reject, `${label} is an accept control`);
  }
  Assert.greater(scoreLabel("设置").manage, 0, "a settings label is recognised");
});

add_task(function test_banner_in_chinese_is_refused() {
  const doc = page(`
    <div role="dialog" aria-modal="true">
      <p>我们使用 cookie 来改善您的体验。</p>
      <button id="accept">全部接受</button>
      <button id="reject">全部拒绝</button>
    </div>
  `);
  const decision = inspectConsent(doc);
  Assert.equal(decision.action, "click", "a reject control is clicked");
  Assert.equal(decision.control.id, "reject", "the accept button is left alone");
});

add_task(function test_banner_in_russian_is_refused() {
  const doc = page(`
    <div role="dialog" aria-modal="true">
      <p>Мы используем файлы cookie, чтобы сайт работал лучше.</p>
      <button id="accept">Принять все</button>
      <button id="reject">Отклонить все</button>
    </div>
  `);
  const decision = inspectConsent(doc);
  Assert.equal(decision.action, "click");
  Assert.equal(decision.control.id, "reject");
});
