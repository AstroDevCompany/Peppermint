/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const {
  base32Decode,
  buildOtpAuth,
  formatCode,
  normalizeSecret,
  parseOtpAuth,
  totpCode,
} = ChromeUtils.importESModule(
  "moz-src:///peppermint/vault/PeppermintVaultTotp.sys.mjs"
);
const { CODE_ORIGIN_PREFIX } = ChromeUtils.importESModule(
  "moz-src:///peppermint/vault/PeppermintVaultCodes.sys.mjs"
);
const { peppermintActions, registerPeppermintActions } =
  ChromeUtils.importESModule(
    "moz-src:///peppermint/common/PeppermintActions.sys.mjs"
  );

// Base32 of the ASCII keys in RFC 6238, appendix B.
const KEY_SHA1 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const KEY_SHA256 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA====";
const KEY_SHA512 =
  "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA=";
const SETUP_KEY = "JBSW Y3DP EHPK 3PXP";
let cleanup;

async function call(method, ...args) {
  return PeppermintVaultRegistry.call("codes", method, ...args);
}

add_task(async function test_rfc_6238_vectors() {
  const vectors = [
    [KEY_SHA1, "SHA1", 59, "94287082"],
    [KEY_SHA1, "SHA1", 1111111109, "07081804"],
    [KEY_SHA1, "SHA1", 1234567890, "89005924"],
    [KEY_SHA1, "SHA1", 20000000000, "65353130"],
    [KEY_SHA256, "SHA256", 59, "46119246"],
    [KEY_SHA512, "SHA512", 59, "90693936"],
  ];
  for (const [secret, algorithm, seconds, expected] of vectors) {
    const { code } = await totpCode({ secret, algorithm, digits: 8 }, seconds * 1000);
    Assert.equal(code, expected, `${algorithm} at ${seconds}s`);
  }
  const { code, expiresAt } = await totpCode({ secret: KEY_SHA1 }, 59000);
  Assert.equal(code.length, 6, "six digits by default");
  Assert.equal(expiresAt, 60000, "a code lasts until the end of its 30 second step");
});

add_task(function test_secret_and_address_parsing() {
  Assert.equal(normalizeSecret(" jbsw-y3dp ehpk=== "), "JBSWY3DPEHPK");
  Assert.equal(base32Decode("!!"), null, "invalid characters are refused");
  Assert.equal(base32Decode(""), null, "an empty secret is refused");
  Assert.equal(formatCode("123456"), "123 456");
  Assert.equal(formatCode("12345678"), "1234 5678");

  const parsed = parseOtpAuth(
    "otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example&period=60&digits=8&algorithm=sha256"
  );
  Assert.deepEqual(parsed, {
    issuer: "Example",
    account: "alice@example.com",
    secret: "JBSWY3DPEHPK3PXP",
    algorithm: "SHA256",
    digits: 8,
    period: 60,
  });
  Assert.equal(parseOtpAuth("otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP"), null, "counter based codes are not supported");
  Assert.equal(parseOtpAuth("https://example.com"), null, "other addresses are refused");
  Assert.equal(parseOtpAuth("otpauth://totp/x?secret=!!"), null, "a bad secret is refused");

  const rebuilt = parseOtpAuth(
    buildOtpAuth({ issuer: "Git Hub", account: "me@x.com", secret: SETUP_KEY })
  );
  Assert.equal(rebuilt.issuer, "Git Hub", "an address built here reads back");
  Assert.equal(rebuilt.secret, "JBSWY3DPEHPK3PXP", "with the secret cleaned up");
});

add_setup(async function () {
  cleanup = await setUpVault({ stepUpMinutes: 0 });
  registerCleanupFunction(async () => {
    for (const login of await Services.logins.getAllLogins()) {
      if (login.origin.startsWith(CODE_ORIGIN_PREFIX)) {
        await Services.logins.removeLoginAsync(login);
      }
    }
    await cleanup();
  });
  unlockVault();
});

add_task(async function test_section_lifecycle() {
  const described = PeppermintVaultRegistry.describeAll().find(s => s.id == "codes");
  Assert.ok(described, "the section is registered");
  Assert.deepEqual(described.createFields, ["issuer", "account", "secret"]);
  Assert.ok(described.formFields.secret, "the form describes the setup key input");

  await call("create", { issuer: "Example", account: "alice", secret: SETUP_KEY });
  const items = await call("list", { now: 59000 });
  Assert.equal(items.length, 1, "the code is listed");
  Assert.equal(items[0].title, "Example");
  Assert.equal(items[0].values.account, "alice");
  Assert.ok(/^\d{3} \d{3}$/.test(items[0].values.code), "as a grouped six digit code");
  Assert.equal(items[0].values.expiresAt, "60000", "with the moment it ends");

  const expected = await totpCode({ secret: "JBSWY3DPEHPK3PXP" }, 59000);
  Assert.equal(items[0].values.code.replace(" ", ""), expected.code, "the code is right");

  const json = JSON.stringify(items);
  Assert.ok(!json.includes("JBSWY3DPEHPK3PXP"), "the list never carries the secret");

  await expectError(
    () => call("create", { issuer: "Example", account: "alice", secret: SETUP_KEY }),
    "VaultSectionError",
    "the same service and account cannot be added twice"
  );
  await expectError(
    () => call("create", { issuer: "Other", account: "bob", secret: "not base32 !!" }),
    "VaultSectionError",
    "an invalid setup key is refused"
  );

  await call("create", {
    secret: "otpauth://totp/Svc:carol?secret=JBSWY3DPEHPK3PXP&issuer=Svc&digits=8",
  });
  const all = await call("list");
  Assert.deepEqual(
    all.map(item => item.title),
    ["Example", "Svc"],
    "an otpauth:// address fills in the service and account"
  );
  Assert.equal(all[1].values.code.replace(" ", "").length, 8, "and its digits");

  Assert.deepEqual(
    (await call("list", { query: "ALI" })).map(i => i.title),
    ["Example"],
    "search matches accounts"
  );

  const id = items[0].id;
  Assert.equal(await call("getSecret", id, "secret"), "JBSWY3DPEHPK3PXP");
  Assert.deepEqual(await call("getEditable", id), { issuer: "Example", account: "alice" });
  await call("update", id, { issuer: "Renamed", account: "alice2" });
  Assert.ok(
    (await call("list")).some(i => i.title == "Renamed" && i.values.account == "alice2"),
    "renaming keeps the code working"
  );

  await call("copy", id, "code");
  Assert.ok(/^\d{6}$/.test(readClipboardText()), "copying puts the plain digits on the clipboard");

  for (const item of await call("list")) {
    await call("remove", item.id);
  }
  Assert.equal((await call("list")).length, 0, "codes can be removed");
});

add_task(async function test_codes_stay_out_of_logins() {
  await call("create", { issuer: "Hidden", account: "me", secret: SETUP_KEY });
  const logins = await PeppermintVaultRegistry.call("logins", "list");
  Assert.ok(
    !logins.some(item => item.title.includes("Hidden") || item.title.includes("peppermint-totp")),
    "the Logins list does not show one-time code entries"
  );
  const stored = (await Services.logins.getAllLogins()).filter(l =>
    l.origin.startsWith(CODE_ORIGIN_PREFIX)
  );
  Assert.equal(stored.length, 1, "the code is stored as a protected login entry");
  Assert.equal(stored[0].formActionOrigin, "", "and can never be filled into a page");
  await call("remove", (await call("list"))[0].id);
});

add_task(async function test_locked_vault_hides_codes() {
  PeppermintVaultSession.lock("test");
  await expectError(() => call("list"), "VaultLockedError", "a locked Vault lists nothing");
  unlockVault();
});

add_task(async function test_palette_actions() {
  registerPeppermintActions();
  const byId = id => peppermintActions().find(action => action.commandId === id);
  const open = byId("peppermint:open-vault");
  const lock = byId("peppermint:lock-vault");
  Assert.ok(open && lock, "both actions exist");
  Assert.ok(open.isAvailable(window), "Open Vault is offered while Vault is on");
  Assert.ok(lock.isAvailable(window), "Lock Vault is offered while it is unlocked");
  lock.command(window);
  Assert.equal(PeppermintVault.state, "locked", "the command locks Vault");
  Assert.ok(!lock.isAvailable(window), "and is hidden once it is locked");
  unlockVault();
});
