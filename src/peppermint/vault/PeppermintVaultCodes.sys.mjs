/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { PeppermintVaultClipboard } from "moz-src:///peppermint/vault/PeppermintVaultClipboard.sys.mjs";
import { VaultSectionError } from "moz-src:///peppermint/vault/PeppermintVaultRegistry.sys.mjs";
import {
  buildOtpAuth,
  formatCode,
  normalizeSecret,
  parseOtpAuth,
  totpCode,
} from "moz-src:///peppermint/vault/PeppermintVaultTotp.sys.mjs";

/**
 * One-time codes. Each code generator is kept as a login entry whose
 * "website" is peppermint-totp://<service>, whose username is the account
 * and whose password is the otpauth:// address with the secret. That means
 * the Primary Password protects it like any saved password, Passwords sync
 * carries it between devices, and it can never be filled into a web page.
 * The Logins section leaves these entries out (see isCodeLogin).
 */

export const CODE_ORIGIN_PREFIX = "peppermint-totp://";

/**
 * @param {nsILoginInfo} login
 * @returns {boolean} The login is a one-time code entry, not a website login
 */
export function isCodeLogin(login) {
  return login.origin.startsWith(CODE_ORIGIN_PREFIX);
}

function originFor(issuer) {
  return `${CODE_ORIGIN_PREFIX}${encodeURIComponent(issuer)}`;
}

function issuerOf(login) {
  return decodeURIComponent(login.origin.slice(CODE_ORIGIN_PREFIX.length));
}

async function allCodeLogins() {
  const logins = await Services.logins.getAllLogins();
  return logins.filter(isCodeLogin);
}

async function findCodeLogin(guid) {
  const login = (await allCodeLogins()).find(entry => entry.guid == guid);
  if (!login) {
    throw new VaultSectionError("not-found");
  }
  return login;
}

async function toItem(login, now) {
  const entry = parseOtpAuth(login.password);
  const issuer = issuerOf(login);
  const values = { account: login.username };
  if (entry) {
    const { code, expiresAt } = await totpCode(entry, now);
    values.code = formatCode(code);
    values.expiresAt = String(expiresAt);
    values.period = String(entry.period);
  }
  return {
    id: login.guid,
    title: issuer || login.username,
    link: null,
    insecure: false,
    values,
    secrets: {},
    lastUsed: login.timeLastUsed,
    changed: login.timePasswordChanged,
    created: login.timeCreated,
    timestamps: [
      { kind: "created", time: login.timeCreated },
      { kind: "used", time: login.timeLastUsed },
    ],
  };
}

const SORTS = {
  title: (a, b) =>
    a.title.localeCompare(b.title) ||
    a.values.account.localeCompare(b.values.account) ||
    a.id.localeCompare(b.id),
  "recent-use": (a, b) => b.lastUsed - a.lastUsed,
};

function secretFrom(text, issuer, account) {
  const fromUri = parseOtpAuth(text);
  if (fromUri) {
    return {
      ...fromUri,
      issuer: issuer || fromUri.issuer,
      account: account || fromUri.account,
    };
  }
  const secret = normalizeSecret(text);
  if (!parseOtpAuth(buildOtpAuth({ issuer: "x", account: "x", secret }))) {
    throw new VaultSectionError("invalid-secret");
  }
  return { issuer, account, secret };
}

function newLogin({ issuer, account, ...entry }) {
  const login = Cc["@mozilla.org/login-manager/loginInfo;1"].createInstance(
    Ci.nsILoginInfo
  );
  login.init(
    originFor(issuer),
    "",
    null,
    account,
    buildOtpAuth({ issuer, account, ...entry }),
    "",
    ""
  );
  return login;
}

export const CodesSection = {
  id: "codes",
  order: 20,
  titleL10nId: "peppermint-vault-section-codes",
  icon: "chrome://browser/skin/zen-icons/security.svg",

  fields: [
    {
      id: "account",
      kind: "text",
      labelL10nId: "peppermint-vault-field-account",
    },
    {
      id: "code",
      kind: "code",
      labelL10nId: "peppermint-vault-field-code",
      copy: true,
    },
  ],
  editFields: ["issuer", "account"],
  createFields: ["issuer", "account", "secret"],
  // Inputs that are not shown as a row field.
  formFields: {
    issuer: { id: "issuer", kind: "text", labelL10nId: "peppermint-vault-field-service" },
    account: { id: "account", kind: "text", labelL10nId: "peppermint-vault-field-account" },
    secret: {
      id: "secret",
      kind: "secret",
      labelL10nId: "peppermint-vault-field-setup-key",
      required: true,
    },
  },

  texts: {
    addTitle: "peppermint-vault-codes-add-title",
    editTitle: "peppermint-vault-codes-edit-title",
    emptyTitle: "peppermint-vault-codes-empty-title",
    emptyDescription: "peppermint-vault-codes-empty-description",
  },
  errors: {
    exists: "peppermint-vault-codes-error-exists",
  },

  filters: [],
  sorts: [
    { id: "title", l10nId: "peppermint-vault-sort-title" },
    { id: "recent-use", l10nId: "peppermint-vault-sort-recent-use" },
  ],

  isAvailable() {
    const policies = Services.policies.getActivePolicies();
    return policies?.PasswordManagerEnabled === false
      ? { available: false, reason: "policy" }
      : { available: true };
  },

  async list({ query = "", sort = "title", now = Date.now() } = {}) {
    const needle = query.trim().toLowerCase();
    const items = await Promise.all(
      (await allCodeLogins()).map(login => toItem(login, now))
    );
    return items
      .filter(
        item =>
          !needle ||
          item.title.toLowerCase().includes(needle) ||
          item.values.account.toLowerCase().includes(needle)
      )
      .sort(SORTS[sort] ?? SORTS.title);
  },

  async getSecret(id, fieldId) {
    if (fieldId != "secret") {
      throw new VaultSectionError("unknown-field");
    }
    return parseOtpAuth((await findCodeLogin(id)).password)?.secret ?? "";
  },

  async copy(id, fieldId) {
    if (fieldId != "code") {
      throw new VaultSectionError("unknown-field");
    }
    const entry = parseOtpAuth((await findCodeLogin(id)).password);
    if (!entry) {
      throw new VaultSectionError("invalid-secret");
    }
    PeppermintVaultClipboard.copy((await totpCode(entry)).code);
  },

  async getEditable(id) {
    const login = await findCodeLogin(id);
    return { issuer: issuerOf(login), account: login.username };
  },

  async create({ issuer = "", account = "", secret }) {
    const entry = secretFrom(secret ?? "", issuer.trim(), account.trim());
    if (!entry.issuer && !entry.account) {
      throw new VaultSectionError("invalid", { message: "A name is needed" });
    }
    try {
      await Services.logins.addLoginAsync(newLogin(entry));
    } catch (error) {
      if (error?.message?.includes("This login already exists")) {
        throw new VaultSectionError("exists");
      }
      throw new VaultSectionError("invalid", { message: error?.message });
    }
  },

  async update(id, { issuer, account }) {
    const existing = await findCodeLogin(id);
    const entry = parseOtpAuth(existing.password);
    if (!entry) {
      throw new VaultSectionError("invalid-secret");
    }
    const next = {
      ...entry,
      issuer: issuer?.trim() ?? issuerOf(existing),
      account: account?.trim() ?? existing.username,
    };
    try {
      await Services.logins.modifyLoginAsync(existing, newLogin(next));
    } catch (error) {
      if (error?.message?.includes("This login already exists")) {
        throw new VaultSectionError("exists");
      }
      throw new VaultSectionError("invalid", { message: error?.message });
    }
  },

  async remove(id) {
    await Services.logins.removeLoginAsync(await findCodeLogin(id));
  },
};
