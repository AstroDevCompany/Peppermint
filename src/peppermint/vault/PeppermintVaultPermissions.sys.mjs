/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  isUserPermission,
  PeppermintVaultPermissionLog,
} from "moz-src:///peppermint/vault/PeppermintVaultPermissionLog.sys.mjs";
import { VaultSectionError } from "moz-src:///peppermint/vault/PeppermintVaultRegistry.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  SitePermissions: "resource:///modules/SitePermissions.sys.mjs",
});

const TYPE_FILTERS = {
  location: "geo",
  camera: "camera",
  microphone: "microphone",
  notifications: "desktop-notification",
};

function idOf(type) {
  return type.split(lazy.SitePermissions.PERM_KEY_DELIMITER)[0];
}

function typeLabel(type) {
  return lazy.SitePermissions.getPermissionLabel(type) ?? type;
}

function stateLabel(type, state) {
  const { SitePermissions } = lazy;
  const id = idOf(type);
  try {
    const label = SitePermissions.getMultichoiceStateLabel(id, state);
    if (label) {
      return label;
    }
  } catch {
    // Not every permission has a label for every state it can be in.
  }
  return SitePermissions.getCurrentStateLabel(state, id) ?? String(state);
}

function principalFor(origin) {
  try {
    return Services.scriptSecurityManager.createContentPrincipalFromOrigin(
      origin
    );
  } catch {
    throw new VaultSectionError("not-found");
  }
}

function siteOf(origin) {
  const principal = principalFor(origin);
  return {
    title: principal.asciiHost || principal.originNoSuffix,
    link: /^https?$/.test(principal.scheme) ? principal.originNoSuffix : null,
  };
}

function exactPermission(principal, type) {
  return Services.perms.getPermissionObject(principal, type, true);
}

function sitePermissions(principal) {
  return Services.perms
    .getAllForPrincipal(principal)
    .filter(isUserPermission);
}

function toPermission(permission) {
  const { SitePermissions } = lazy;
  const id = idOf(permission.type);
  return {
    key: permission.type,
    label: typeLabel(permission.type),
    state: String(permission.capability),
    stateLabel: stateLabel(permission.type, permission.capability),
    options: SitePermissions.getAvailableStates(id).map(state => ({
      value: String(state),
      label: stateLabel(permission.type, state),
    })),
    readOnly: permission.expireType == Services.perms.EXPIRE_POLICY,
    session: permission.expireType == Services.perms.EXPIRE_SESSION,
    time: permission.modificationTime,
  };
}

function groupBySite() {
  const sites = new Map();
  for (const permission of Services.perms.all.filter(isUserPermission)) {
    const origin = permission.principal.origin;
    if (!sites.has(origin)) {
      sites.set(origin, []);
    }
    sites.get(origin).push(permission);
  }
  return sites;
}

function toItem(origin, permissions) {
  const permissionItems = permissions
    .map(toPermission)
    .sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
  const changed = Math.max(...permissionItems.map(p => p.time));
  return {
    id: origin,
    ...siteOf(origin),
    insecure: false,
    values: { permissions: permissionItems },
    secrets: {},
    lastUsed: changed,
    changed,
    timestamps: [{ kind: "modified", time: changed }],
  };
}

function hasCapability(item, capability) {
  return item.values.permissions.some(p => p.state == String(capability));
}

const FILTERS = {
  all: () => true,
  allowed: item => hasCapability(item, lazy.SitePermissions.ALLOW),
  blocked: item => hasCapability(item, lazy.SitePermissions.BLOCK),
  ...Object.fromEntries(
    Object.entries(TYPE_FILTERS).map(([name, id]) => [
      name,
      item => item.values.permissions.some(p => idOf(p.key) == id),
    ])
  ),
};

const SORTS = {
  title: (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
  "recent-change": (a, b) => b.changed - a.changed,
};

const availability = () => {
  const policies = Services.policies.getActivePolicies();
  return policies?.PasswordManagerEnabled === false
    ? { available: false, reason: "policy" }
    : { available: true };
};

/**
 * Every permission a website currently has (camera, location, notifications,
 * pop-ups and so on), one row per website, each with a menu to change it.
 * Nothing here is secret, so changing a permission needs only the Primary
 * Password check every edit already has.
 */
export const PermissionsSection = {
  id: "permissions",
  order: 30,
  titleL10nId: "peppermint-vault-section-permissions",
  icon: "chrome://browser/skin/zen-icons/permissions.svg",
  refreshOn: ["perm-changed"],

  fields: [
    {
      id: "permissions",
      kind: "choices",
      labelL10nId: "peppermint-vault-section-permissions",
    },
  ],
  editFields: [],
  createFields: [],

  texts: {
    emptyTitle: "peppermint-vault-permissions-empty-title",
    emptyDescription: "peppermint-vault-permissions-empty-description",
    removeRow: "peppermint-vault-permissions-reset",
    removeRowConfirm: "peppermint-vault-permissions-reset-confirm",
  },
  errors: {
    "read-only": "peppermint-vault-permissions-error-read-only",
    "invalid-state": "peppermint-vault-permissions-error-invalid-state",
  },

  filters: [
    { id: "all", l10nId: "peppermint-vault-filter-all" },
    { id: "allowed", l10nId: "peppermint-vault-permissions-filter-allowed" },
    { id: "blocked", l10nId: "peppermint-vault-permissions-filter-blocked" },
    ...Object.keys(TYPE_FILTERS).map(name => ({
      id: name,
      l10nId: `peppermint-vault-permissions-filter-${name}`,
    })),
  ],
  sorts: [
    { id: "title", l10nId: "peppermint-vault-sort-title" },
    { id: "recent-change", l10nId: "peppermint-vault-sort-recent-change" },
  ],

  isAvailable: availability,

  async list({ query = "", filter = "all", sort = "title" } = {}) {
    const needle = query.trim().toLowerCase();
    const matchesFilter = FILTERS[filter] ?? FILTERS.all;
    return [...groupBySite()]
      .map(([origin, permissions]) => toItem(origin, permissions))
      .filter(
        item =>
          matchesFilter(item) &&
          (!needle ||
            item.title.toLowerCase().includes(needle) ||
            item.values.permissions.some(p =>
              p.label.toLowerCase().includes(needle)
            ))
      )
      .sort(SORTS[sort] ?? SORTS.title);
  },

  async update(id, { permission, state }) {
    const { SitePermissions } = lazy;
    const principal = principalFor(id);
    const existing = exactPermission(principal, permission);
    if (!existing || !isUserPermission(existing)) {
      throw new VaultSectionError("not-found");
    }
    if (existing.expireType == Services.perms.EXPIRE_POLICY) {
      throw new VaultSectionError("read-only");
    }
    const next = Number(state);
    if (!SitePermissions.getAvailableStates(idOf(permission)).includes(next)) {
      throw new VaultSectionError("invalid-state");
    }
    SitePermissions.setForPrincipal(
      principal,
      permission,
      next,
      existing.expireType == Services.perms.EXPIRE_SESSION
        ? SitePermissions.SCOPE_SESSION
        : SitePermissions.SCOPE_PERSISTENT
    );
  },

  /** Resets every permission the website has, except those set by policy. */
  async remove(id) {
    const principal = principalFor(id);
    for (const permission of sitePermissions(principal)) {
      if (permission.expireType != Services.perms.EXPIRE_POLICY) {
        lazy.SitePermissions.removeFromPrincipal(principal, permission.type);
      }
    }
  },
};

function describeChange(entry) {
  const { SitePermissions } = lazy;
  const fallback = SitePermissions.getDefault(idOf(entry.type));
  const label = state => stateLabel(entry.type, state ?? fallback);
  return `${label(entry.from)} → ${label(entry.to)}`;
}

function toHistoryItem(entry, seq) {
  return {
    id: entry.id,
    ...siteOf(entry.origin),
    insecure: false,
    values: {
      permission: typeLabel(entry.type),
      change: describeChange(entry),
    },
    secrets: {},
    lastUsed: entry.time,
    changed: entry.time,
    to: entry.to,
    seq,
    timestamps: [{ kind: "event", time: entry.time }],
  };
}

const HISTORY_FILTERS = {
  all: () => true,
  allowed: item => item.to == lazy.SitePermissions.ALLOW,
  blocked: item => item.to == lazy.SitePermissions.BLOCK,
  reset: item => item.to === null,
};

const HISTORY_SORTS = {
  "recent-change": (a, b) => b.changed - a.changed || b.seq - a.seq,
  oldest: (a, b) => a.changed - b.changed || a.seq - b.seq,
  title: (a, b) =>
    a.title.localeCompare(b.title) || b.changed - a.changed || b.seq - a.seq,
};

/**
 * Every change to a website's permissions with the time it happened, newest
 * first. See PeppermintVaultPermissionLog for what is recorded.
 */
export const PermissionHistorySection = {
  id: "permission-history",
  order: 40,
  titleL10nId: "peppermint-vault-section-permission-history",
  icon: "chrome://browser/skin/zen-icons/history.svg",
  refreshOn: ["perm-changed"],

  fields: [
    {
      id: "permission",
      kind: "text",
      labelL10nId: "peppermint-vault-field-permission",
    },
    {
      id: "change",
      kind: "text",
      labelL10nId: "peppermint-vault-field-change",
    },
  ],
  editFields: [],
  createFields: [],
  clearable: true,

  texts: {
    emptyTitle: "peppermint-vault-history-empty-title",
    emptyDescription: "peppermint-vault-history-empty-description",
    clear: "peppermint-vault-history-clear",
    clearConfirm: "peppermint-vault-history-clear-confirm",
  },

  filters: [
    { id: "all", l10nId: "peppermint-vault-filter-all" },
    { id: "allowed", l10nId: "peppermint-vault-permissions-filter-allowed" },
    { id: "blocked", l10nId: "peppermint-vault-permissions-filter-blocked" },
    { id: "reset", l10nId: "peppermint-vault-history-filter-reset" },
  ],
  sorts: [
    { id: "recent-change", l10nId: "peppermint-vault-history-sort-newest" },
    { id: "oldest", l10nId: "peppermint-vault-history-sort-oldest" },
    { id: "title", l10nId: "peppermint-vault-sort-title" },
  ],

  isAvailable: availability,

  async list({ query = "", filter = "all", sort = "recent-change" } = {}) {
    const needle = query.trim().toLowerCase();
    const matchesFilter = HISTORY_FILTERS[filter] ?? HISTORY_FILTERS.all;
    return (await PeppermintVaultPermissionLog.entries())
      .filter(entry => lazy.SitePermissions.isSitePermission(entry.type))
      .map(toHistoryItem)
      .filter(
        item =>
          matchesFilter(item) &&
          (!needle ||
            item.title.toLowerCase().includes(needle) ||
            item.values.permission.toLowerCase().includes(needle))
      )
      .sort(HISTORY_SORTS[sort] ?? HISTORY_SORTS["recent-change"]);
  },

  async clear() {
    await PeppermintVaultPermissionLog.clear();
  },
};
