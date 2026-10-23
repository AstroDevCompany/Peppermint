/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { PeppermintVaultPermissionLog } = ChromeUtils.importESModule(
  "moz-src:///peppermint/vault/PeppermintVaultPermissionLog.sys.mjs"
);

const { SitePermissions } = ChromeUtils.importESModule(
  "resource:///modules/SitePermissions.sys.mjs"
);

const SITE = "https://permissions.example.com";
const PRIVATE_SITE = "https://private.example.com";
let cleanup;
let logPath;

function principalOf(origin, attributes = {}) {
  return Services.scriptSecurityManager.createContentPrincipal(
    Services.io.newURI(origin),
    attributes
  );
}

function callPermissions(method, ...args) {
  return PeppermintVaultRegistry.call("permissions", method, ...args);
}

function callHistory(method, ...args) {
  return PeppermintVaultRegistry.call("permission-history", method, ...args);
}

async function itemFor(host) {
  return (await callPermissions("list", { query: host })).find(
    item => item.title == host
  );
}

add_setup(async function () {
  logPath = PathUtils.join(PathUtils.tempDir, "vault-permission-history.json");
  await IOUtils.remove(logPath, { ignoreAbsent: true });
  PeppermintVaultPermissionLog.testing.setPath(logPath);
  cleanup = await setUpVault({ stepUpMinutes: 0 });
  registerCleanupFunction(async () => {
    await cleanup();
    Services.perms.removeFromPrincipal(principalOf(SITE), "camera");
    Services.perms.removeFromPrincipal(
      principalOf(SITE),
      "desktop-notification"
    );
    await IOUtils.remove(logPath, { ignoreAbsent: true });
  });
  unlockVault();
  await PeppermintVaultPermissionLog.testing.ready();
  await callHistory("clear");
});

add_task(async function test_active_permissions_are_listed() {
  const principal = principalOf(SITE);
  Services.perms.addFromPrincipal(
    principal,
    "camera",
    Services.perms.ALLOW_ACTION
  );
  Services.perms.addFromPrincipal(
    principal,
    "desktop-notification",
    Services.perms.DENY_ACTION
  );

  const item = await itemFor("permissions.example.com");
  Assert.ok(item, "The website is listed");
  Assert.equal(item.link, SITE);
  Assert.deepEqual(
    item.values.permissions.map(p => p.key).sort(),
    ["camera", "desktop-notification"],
    "With each permission it has"
  );
  const camera = item.values.permissions.find(p => p.key == "camera");
  Assert.equal(camera.state, String(Services.perms.ALLOW_ACTION));
  Assert.ok(camera.options.length >= 2, "Offering the states to switch to");
  Assert.greater(camera.time, 0, "And when it last changed");
  Assert.equal(item.timestamps[0].kind, "modified");

  Assert.equal(
    (await callPermissions("list", { filter: "blocked" })).filter(
      i => i.title == "permissions.example.com"
    ).length,
    1,
    "Filtering by blocked finds it"
  );
  Assert.equal(
    (await callPermissions("list", { filter: "location" })).filter(
      i => i.title == "permissions.example.com"
    ).length,
    0,
    "A permission it does not have does not match"
  );
  Assert.equal(
    (await callPermissions("list", { query: "camera" })).filter(
      i => i.title == "permissions.example.com"
    ).length,
    1,
    "Search matches the permission name"
  );
});

add_task(async function test_change_and_reset_a_permission() {
  const id = principalOf(SITE).origin;
  await callPermissions("update", id, {
    permission: "camera",
    state: String(Services.perms.DENY_ACTION),
  });
  Assert.equal(
    Services.perms.testExactPermissionFromPrincipal(
      principalOf(SITE),
      "camera"
    ),
    Services.perms.DENY_ACTION,
    "The permission changed"
  );

  await callPermissions("update", id, { permission: "camera", state: "0" });
  Assert.equal(
    Services.perms.testExactPermissionFromPrincipal(
      principalOf(SITE),
      "camera"
    ),
    Services.perms.UNKNOWN_ACTION,
    "Choosing the default state removes it"
  );

  const missing = await expectError(
    () => callPermissions("update", id, { permission: "camera", state: "1" }),
    "VaultSectionError",
    "A permission the website no longer has is refused"
  );
  Assert.equal(missing.code, "not-found");

  Services.perms.addFromPrincipal(
    principalOf(SITE),
    "camera",
    Services.perms.ALLOW_ACTION
  );
  const invalid = await expectError(
    () => callPermissions("update", id, { permission: "camera", state: "99" }),
    "VaultSectionError",
    "A state the permission does not offer is refused"
  );
  Assert.equal(invalid.code, "invalid-state");
});

add_task(async function test_policy_permissions_are_read_only() {
  const principal = principalOf("https://policy.example.com");
  Services.perms.addFromPrincipal(
    principal,
    "camera",
    Services.perms.DENY_ACTION,
    Services.perms.EXPIRE_POLICY
  );
  try {
    const item = await itemFor("policy.example.com");
    Assert.ok(item.values.permissions[0].readOnly, "Marked read-only");
    const error = await expectError(
      () =>
        callPermissions("update", principal.origin, {
          permission: "camera",
          state: String(Services.perms.ALLOW_ACTION),
        }),
      "VaultSectionError",
      "Policy permissions cannot be changed"
    );
    Assert.equal(error.code, "read-only");
    await callPermissions("remove", principal.origin);
    Assert.equal(
      Services.perms.testExactPermissionFromPrincipal(principal, "camera"),
      Services.perms.DENY_ACTION,
      "Nor reset"
    );
  } finally {
    Services.perms.removeFromPrincipal(principal, "camera");
  }
});

add_task(async function test_history_records_changes_with_times() {
  await callHistory("clear");
  const principal = principalOf(SITE);
  const before = Date.now();
  Services.perms.addFromPrincipal(
    principal,
    "camera",
    Services.perms.DENY_ACTION
  );
  Services.perms.addFromPrincipal(
    principal,
    "camera",
    Services.perms.DENY_ACTION
  );
  Services.perms.removeFromPrincipal(principal, "camera");

  const items = await callHistory("list", { query: "permissions.example.com" });
  Assert.equal(items.length, 2, "A repeated state is not a change");
  const [removed, blocked] = items;
  const blockLabel = SitePermissions.getMultichoiceStateLabel(
    "camera",
    SitePermissions.BLOCK
  );
  Assert.ok(blocked.values.change.endsWith(blockLabel), "Blocked ends as Block");
  Assert.ok(
    removed.values.change.startsWith(blockLabel),
    "A reset starts from Block"
  );
  Assert.equal(blocked.timestamps[0].kind, "event");
  Assert.greaterOrEqual(blocked.timestamps[0].time, before, "With a time");
  Assert.equal(removed.values.permission, blocked.values.permission);
  Assert.equal(removed.to, null, "Removal is recorded as a reset");

  Assert.equal(
    (await callHistory("list", { filter: "reset" })).length,
    1,
    "The reset filter finds it"
  );
  Assert.equal(
    (await callHistory("list", { filter: "blocked" })).length,
    1,
    "The blocked filter finds the block"
  );
  Assert.deepEqual(
    (await callHistory("list", { sort: "oldest" })).map(i => i.id),
    [blocked.id, removed.id],
    "Oldest first can be chosen"
  );
});

add_task(async function test_history_ignores_private_windows() {
  const principal = principalOf(PRIVATE_SITE, { privateBrowsingId: 1 });
  Services.perms.addFromPrincipal(
    principal,
    "camera",
    Services.perms.ALLOW_ACTION
  );
  try {
    Assert.equal(
      (await callHistory("list", { query: "private.example.com" })).length,
      0,
      "Private permissions are not recorded"
    );
  } finally {
    Services.perms.removeFromPrincipal(principal, "camera");
  }
});

add_task(async function test_history_is_limited_and_cleared() {
  Services.prefs.setIntPref("peppermint.vault.permission-history-limit", 3);
  const principal = principalOf(SITE);
  for (let i = 0; i < 6; i++) {
    Services.perms.addFromPrincipal(
      principal,
      "camera",
      i % 2 ? Services.perms.ALLOW_ACTION : Services.perms.DENY_ACTION
    );
  }
  Assert.equal(
    (await callHistory("list")).length,
    3,
    "Only the newest entries are kept"
  );
  Services.prefs.clearUserPref("peppermint.vault.permission-history-limit");

  await callHistory("clear");
  Assert.equal((await callHistory("list")).length, 0, "Clearing empties it");
  Services.perms.removeFromPrincipal(principal, "camera");
});

add_task(async function test_clearing_site_settings_clears_history() {
  Services.perms.addFromPrincipal(
    principalOf(SITE),
    "camera",
    Services.perms.ALLOW_ACTION
  );
  Assert.greater((await callHistory("list")).length, 0);
  Services.perms.removeAll();
  Assert.equal(
    (await callHistory("list")).length,
    0,
    "Clearing all site settings forgets the history too"
  );
});

add_task(async function test_history_needs_the_session() {
  PeppermintVaultSession.lock("test");
  await expectError(
    () => callHistory("list"),
    "VaultLockedError",
    "History is not readable while locked"
  );
  await expectError(
    () => callPermissions("list"),
    "VaultLockedError",
    "Neither are permissions"
  );
  unlockVault();
});
