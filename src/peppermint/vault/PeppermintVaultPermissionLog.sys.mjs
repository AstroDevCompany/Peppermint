/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  JSONFile: "resource://gre/modules/JSONFile.sys.mjs",
  SitePermissions: "resource:///modules/SitePermissions.sys.mjs",
});

const FILE_NAME = "peppermint-permission-history.json";
const LIMIT_PREF = "peppermint.vault.permission-history-limit";
const DEFAULT_LIMIT = 1000;
const SAVE_DELAY_MS = 1000;

/**
 * Whether a permission is one the user manages from the site information
 * panel: a supported site, a known and enabled permission type, and not a
 * temporary or tab scoped grant.
 *
 * @param {nsIPermission} permission
 * @returns {boolean}
 */
export function isUserPermission(permission) {
  const { SitePermissions } = lazy;
  const { EXPIRE_TIME, EXPIRE_SESSION_TAB } = Ci.nsIPermissionManager;
  if (
    permission.expireType == EXPIRE_TIME ||
    permission.expireType == EXPIRE_SESSION_TAB ||
    permission.principal.privateBrowsingId
  ) {
    return false;
  }
  const [id] = permission.type.split(SitePermissions.PERM_KEY_DELIMITER);
  return (
    SitePermissions.isSupportedPrincipal(permission.principal) &&
    SitePermissions.listPermissions().includes(id)
  );
}

function keyOf(permission) {
  return `${permission.principal.origin}\n${permission.type}`;
}

/**
 * A local record of every change to a website's permissions, because the
 * permission manager only keeps the current state. Recording runs while Vault
 * is on. The first time it starts, the permissions that already exist are
 * added with the time they were last modified. Nothing from private windows
 * is recorded, and clearing site settings from the browser clears the record.
 *
 * Each entry is { id, time, origin, type, from, to, seeded? } where from and
 * to are permission states, or null when the permission did not exist (before)
 * or was removed (after).
 */
class PermissionLog {
  #file = null;
  #ready = null;
  #known = new Map();
  #path = null;

  start() {
    if (this.#ready) {
      return;
    }
    Services.obs.addObserver(this, "perm-changed");
    this.#ready = this.#load();
  }

  stop() {
    if (!this.#ready) {
      return;
    }
    Services.obs.removeObserver(this, "perm-changed");
    const file = this.#file;
    this.#ready = null;
    this.#file = null;
    this.#known.clear();
    file?.finalize().catch(console.error);
  }

  async #load() {
    const file = new lazy.JSONFile({
      path: this.#path ?? PathUtils.join(PathUtils.profileDir, FILE_NAME),
      saveDelayMs: SAVE_DELAY_MS,
      dataPostProcessor: data => ({
        entries: Array.isArray(data?.entries) ? data.entries : null,
      }),
    });
    await file.load();
    const current = Services.perms.all.filter(isUserPermission);
    if (!file.data.entries) {
      file.data.entries = current.map(permission => ({
        id: this.#newId(),
        time: permission.modificationTime || Date.now(),
        origin: permission.principal.originNoSuffix,
        type: permission.type,
        from: null,
        to: permission.capability,
        seeded: true,
      }));
      file.saveSoon();
    }
    this.#known = new Map(current.map(p => [keyOf(p), p.capability]));
    this.#file = file;
  }

  #newId() {
    return Services.uuid.generateUUID().toString().slice(1, -1);
  }

  /**
   * @returns {Promise<object[]>} A copy of the entries, oldest first.
   */
  async entries() {
    await this.#ready;
    return this.#file ? this.#file.data.entries.slice() : [];
  }

  /** Forgets every entry. */
  async clear() {
    await this.#ready;
    if (this.#file) {
      this.#file.data.entries = [];
      this.#file.saveSoon();
    }
  }

  async #record(topic, data, permission) {
    await this.#ready;
    const file = this.#file;
    if (!file) {
      return;
    }
    if (data == "cleared") {
      this.#known.clear();
      file.data.entries = [];
      file.saveSoon();
      return;
    }
    if (!permission || !isUserPermission(permission)) {
      return;
    }
    const key = keyOf(permission);
    const from = this.#known.get(key) ?? null;
    let to = null;
    if (data == "deleted") {
      this.#known.delete(key);
    } else {
      to = permission.capability;
      this.#known.set(key, to);
    }
    if (from === to) {
      return;
    }
    const { entries } = file.data;
    entries.push({
      id: this.#newId(),
      time: Date.now(),
      origin: permission.principal.originNoSuffix,
      type: permission.type,
      from,
      to,
    });
    const limit = Math.max(
      1,
      Services.prefs.getIntPref(LIMIT_PREF, DEFAULT_LIMIT)
    );
    if (entries.length > limit) {
      entries.splice(0, entries.length - limit);
    }
    file.saveSoon();
  }

  observe(subject, topic, data) {
    let permission = null;
    if (data != "cleared") {
      try {
        permission = subject.QueryInterface(Ci.nsIPermission);
      } catch {
        return;
      }
    }
    this.#record(topic, data, permission).catch(console.error);
  }

  QueryInterface = ChromeUtils.generateQI([
    "nsIObserver",
    "nsISupportsWeakReference",
  ]);

  /** Test hook: where the record is stored, and waiting for it to settle. */
  get testing() {
    if (!Cu.isInAutomation) {
      throw new Error("Only available in automation");
    }
    return {
      setPath: path => (this.#path = path),
      ready: () => this.#ready,
    };
  }
}

export const PeppermintVaultPermissionLog = new PermissionLog();
