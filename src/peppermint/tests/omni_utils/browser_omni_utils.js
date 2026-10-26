/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

ChromeUtils.defineESModuleGetters(this, {
  decodeBase64Text:
    "moz-src:///peppermint/omni-utils/PeppermintOmniUtils.sys.mjs",
  matchOmniTool: "moz-src:///peppermint/omni-utils/PeppermintOmniUtils.sys.mjs",
  omniResults: "moz-src:///peppermint/omni-utils/PeppermintOmniUtils.sys.mjs",
  parseColor: "moz-src:///peppermint/omni-utils/PeppermintOmniUtils.sys.mjs",
  displayValue:
    "moz-src:///peppermint/omni-utils/PeppermintUrlbarProviderOmniUtils.sys.mjs",
  UrlbarTestUtils: "resource://testing-common/UrlbarTestUtils.sys.mjs",
});

const PROVIDER = "PeppermintUrlbarProviderOmniUtils";
const PREF = "peppermint.urlbar.omni-utils.enabled";

async function answer(input, kind) {
  const results = await omniResults(input);
  return results.find(result => result.kind == kind)?.value;
}

add_task(function test_only_keywords_and_colors_match() {
  Assert.ok(matchOmniTool("b64 hello"), "A keyword matches");
  Assert.ok(matchOmniTool("JWT a.b"), "Keywords ignore case");
  Assert.ok(matchOmniTool("#ff6600"), "A color matches");
  Assert.ok(!matchOmniTool("hello world"), "A search does not");
  Assert.ok(!matchOmniTool("b64hello"), "A keyword needs a space after it");
  Assert.ok(!matchOmniTool("#hashtag"), "A hashtag is not a color");
  Assert.ok(!matchOmniTool(""), "Nothing does not");
});

add_task(async function test_base64() {
  Assert.equal(
    await answer("b64 hello world", "base64-encoded"),
    "aGVsbG8gd29ybGQ="
  );
  Assert.equal(
    await answer("b64 aGVsbG8gd29ybGQ=", "base64-decoded"),
    "hello world"
  );
  Assert.equal(
    await answer("b64 aGVsbG8gd29ybGQ", "base64-decoded"),
    "hello world",
    "Padding is optional"
  );
  Assert.equal(decodeBase64Text("not base64!"), null);
  Assert.equal(
    await answer("b64 héllo", "base64-encoded"),
    "aMOpbGxv",
    "UTF-8 is kept"
  );
});

add_task(async function test_url_encoding() {
  Assert.equal(await answer("urlenc a b&c", "url-encoded"), "a%20b%26c");
  Assert.equal(await answer("urldec a%20b%26c", "url-decoded"), "a b&c");
  Assert.deepEqual(
    await omniResults("urldec %E0%A4%A"),
    [],
    "Bad input gives nothing"
  );
});

add_task(async function test_jwt() {
  const token =
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIiwiZXhwIjoxNzAwMDAwMDAwfQ.signature";
  Assert.equal(
    await answer(`jwt ${token}`, "jwt-payload"),
    '{"sub":"1","exp":1700000000}'
  );
  Assert.equal(await answer(`jwt ${token}`, "jwt-header"), '{"alg":"HS256"}');
  Assert.equal(
    await answer(`jwt ${token}`, "jwt-expired"),
    "2023-11-14T22:13:20.000Z"
  );
  Assert.deepEqual(await omniResults("jwt nope"), []);
});

add_task(async function test_timestamps() {
  Assert.equal(
    await answer("ts 1730000000", "timestamp-utc"),
    "2024-10-27T03:33:20.000Z"
  );
  Assert.equal(
    await answer("ts 1730000000000", "timestamp-utc"),
    "2024-10-27T03:33:20.000Z",
    "Milliseconds work too"
  );
  Assert.equal(
    await answer("epoch 2024-01-02T00:00:00Z", "timestamp-seconds"),
    "1704153600"
  );
  const now = await answer("ts", "timestamp-seconds");
  Assert.ok(
    Math.abs(Number(now) - Date.now() / 1000) < 5,
    "No argument means now"
  );
});

add_task(async function test_generators() {
  const uuids = await omniResults("uuid 3");
  Assert.equal(uuids.length, 3);
  Assert.ok(uuids.every(({ value }) => /^[0-9a-f-]{36}$/.test(value)));
  Assert.equal((await omniResults("uuid 999")).length, 10, "UUIDs are capped");

  Assert.equal((await answer("pw", "password")).length, 20);
  Assert.equal((await answer("pw 32", "password")).length, 32);
  Assert.equal(
    (await answer("pw 2", "password")).length,
    4,
    "Short passwords are raised"
  );
  Assert.deepEqual(await omniResults("pw many"), []);

  Assert.equal(await answer("lorem 3", "lorem"), "Lorem ipsum dolor.");
  Assert.equal((await answer("lorem 9999", "lorem")).split(" ").length, 500);
});

add_task(async function test_hashes() {
  Assert.equal(
    await answer("sha256 abc", "hash-sha256"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  );
  Assert.equal(
    await answer("sha1 abc", "hash-sha1"),
    "a9993e364706816aba3e25717850c26c9cd0d89d"
  );
  Assert.deepEqual(await omniResults("sha256"), [], "A hash needs text");
});

add_task(async function test_json() {
  Assert.equal(
    await answer('json {"a":[1,2]}', "json-minified"),
    '{"a":[1,2]}'
  );
  Assert.equal(
    await answer('json {"a":1}', "json-formatted"),
    '{\n  "a": 1\n}'
  );
  Assert.deepEqual(
    await omniResults("json tutorial"),
    [],
    "Plain words are not JSON"
  );
  Assert.deepEqual(
    await omniResults("json 12"),
    [],
    "A bare number is not worth formatting"
  );
});

add_task(async function test_colors() {
  for (const input of [
    "#f60",
    "#ff6600",
    "rgb(255 102 0)",
    "rgb(255, 102, 0)",
    "hsl(24, 100%, 50%)",
  ]) {
    Assert.equal(
      await answer(input, "color-hex"),
      "#ff6600",
      `${input} as hex`
    );
    Assert.equal(
      await answer(input, "color-rgb"),
      "rgb(255, 102, 0)",
      `${input} as rgb`
    );
    Assert.equal(
      await answer(input, "color-hsl"),
      "hsl(24, 100%, 50%)",
      `${input} as hsl`
    );
  }
  Assert.equal(
    await answer("rgba(255, 102, 0, 0.5)", "color-hex"),
    "#ff660080"
  );
  Assert.equal(parseColor("#12345"), null, "Five digits are no color");
  Assert.equal(parseColor("rgb(300, 0, 0)"), null, "Channels stay in range");
});

add_task(function test_display_value() {
  Assert.equal(displayValue("a\n  b"), "a b");
  Assert.equal(
    displayValue("x".repeat(300)).length,
    101,
    "Long values are cut"
  );
});

async function omniResultsInUrlbar(value) {
  await UrlbarTestUtils.promiseAutocompleteResultPopup({
    window,
    waitForFocus,
    value,
  });
  const found = [];
  for (let i = 0; i < UrlbarTestUtils.getResultCount(window); i++) {
    const { result } = await UrlbarTestUtils.getDetailsOfResultAt(window, i);
    if (result.providerName == PROVIDER) {
      found.push(result.payload);
    }
  }
  await UrlbarTestUtils.promisePopupClose(window);
  return found;
}

add_task(async function test_urlbar_results_and_copy() {
  const payloads = await omniResultsInUrlbar("sha256 abc");
  Assert.equal(payloads.length, 1, "The tool answers in the address bar");
  Assert.equal(payloads[0].kind, "hash-sha256");

  await UrlbarTestUtils.promiseAutocompleteResultPopup({
    window,
    waitForFocus,
    value: "sha256 abc",
  });
  let index = 0;
  for (; index < UrlbarTestUtils.getResultCount(window); index++) {
    const { result } = await UrlbarTestUtils.getDetailsOfResultAt(
      window,
      index
    );
    if (result.providerName == PROVIDER) {
      break;
    }
  }
  const expected = payloads[0].value;
  await SimpleTest.promiseClipboardChange(expected, () => {
    EventUtils.synthesizeMouseAtCenter(
      UrlbarTestUtils.getRowAt(window, index),
      {},
      window
    );
  });
  await UrlbarTestUtils.promisePopupClose(window);
});

add_task(async function test_pref_turns_it_off() {
  await SpecialPowers.pushPrefEnv({ set: [[PREF, false]] });
  const payloads = await omniResultsInUrlbar("sha256 abc");
  Assert.equal(payloads.length, 0, "Nothing is answered when it is off");
  await SpecialPowers.popPrefEnv();
});
