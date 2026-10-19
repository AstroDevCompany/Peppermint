/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Time-based one-time passwords (RFC 6238), the six digit codes that
 * authenticator apps show. Nothing here stores or sends anything.
 */

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const HASHES = { SHA1: "SHA-1", SHA256: "SHA-256", SHA512: "SHA-512" };
const DEFAULTS = { algorithm: "SHA1", digits: 6, period: 30 };

/**
 * @param {string} text - A secret as services show it: letters and digits,
 *   often in groups separated by spaces or dashes
 * @returns {string} Upper case without separators or padding
 */
export function normalizeSecret(text) {
  return String(text ?? "")
    .toUpperCase()
    .replace(/[\s-]+/g, "")
    .replace(/=+$/, "");
}

/**
 * @param {string} text
 * @returns {Uint8Array|null} The secret's bytes, or null when it is not valid
 *   base32 or is empty
 */
export function base32Decode(text) {
  const secret = normalizeSecret(text);
  if (!secret) {
    return null;
  }
  const bytes = [];
  let buffer = 0;
  let bits = 0;
  for (const char of secret) {
    const value = BASE32.indexOf(char);
    if (value < 0) {
      return null;
    }
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return bytes.length ? new Uint8Array(bytes) : null;
}

function positiveInt(value, fallback, allowed) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && allowed(number) ? number : fallback;
}

/**
 * Reads an otpauth://totp/ address, the text inside the QR codes services show.
 *
 * @param {string} uri
 * @returns {{issuer: string, account: string, secret: string,
 *   algorithm: string, digits: number, period: number}|null}
 */
export function parseOtpAuth(uri) {
  const url = URL.parse(String(uri ?? "").trim());
  if (!url || url.protocol !== "otpauth:" || url.hostname !== "totp") {
    return null;
  }
  const secret = normalizeSecret(url.searchParams.get("secret"));
  if (!base32Decode(secret)) {
    return null;
  }
  const label = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const colon = label.indexOf(":");
  const labelIssuer = colon >= 0 ? label.slice(0, colon).trim() : "";
  const account = (colon >= 0 ? label.slice(colon + 1) : label).trim();
  const algorithm = (url.searchParams.get("algorithm") || "SHA1").toUpperCase();
  return {
    issuer: (url.searchParams.get("issuer") || labelIssuer).trim(),
    account,
    secret,
    algorithm: HASHES[algorithm] ? algorithm : DEFAULTS.algorithm,
    digits: positiveInt(url.searchParams.get("digits"), DEFAULTS.digits, n => n >= 6 && n <= 8),
    period: positiveInt(url.searchParams.get("period"), DEFAULTS.period, n => n >= 1 && n <= 300),
  };
}

/**
 * @param {{issuer: string, account: string, secret: string,
 *   algorithm?: string, digits?: number, period?: number}} entry
 * @returns {string} An otpauth://totp/ address holding everything needed to
 *   generate codes
 */
export function buildOtpAuth({
  issuer,
  account,
  secret,
  algorithm = DEFAULTS.algorithm,
  digits = DEFAULTS.digits,
  period = DEFAULTS.period,
}) {
  const label = issuer
    ? `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`
    : encodeURIComponent(account);
  const params = new URLSearchParams({
    secret: normalizeSecret(secret),
    ...(issuer ? { issuer } : {}),
    algorithm,
    digits: String(digits),
    period: String(period),
  });
  return `otpauth://totp/${label}?${params}`;
}

/**
 * The code for a moment in time.
 *
 * @param {{secret: string, algorithm?: string, digits?: number,
 *   period?: number}} entry
 * @param {number} [now] - Milliseconds since the epoch
 * @returns {Promise<{code: string, expiresAt: number, period: number}>}
 */
export async function totpCode(
  {
    secret,
    algorithm = DEFAULTS.algorithm,
    digits = DEFAULTS.digits,
    period = DEFAULTS.period,
  },
  now = Date.now()
) {
  const key = base32Decode(secret);
  if (!key || !HASHES[algorithm]) {
    throw new Error("Not a usable one-time code secret");
  }
  const step = Math.floor(now / 1000 / period);
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setUint32(0, Math.floor(step / 2 ** 32));
  new DataView(counter.buffer).setUint32(4, step % 2 ** 32);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: HASHES[algorithm] },
    false,
    ["sign"]
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, counter));
  const offset = mac[mac.length - 1] & 0x0f;
  const truncated =
    ((mac[offset] & 0x7f) << 24) |
    (mac[offset + 1] << 16) |
    (mac[offset + 2] << 8) |
    mac[offset + 3];
  return {
    code: String(truncated % 10 ** digits).padStart(digits, "0"),
    expiresAt: (step + 1) * period * 1000,
    period,
  };
}

/**
 * @param {string} code - Digits only
 * @returns {string} The code in two groups, as it is easier to read and type
 */
export function formatCode(code) {
  const half = Math.ceil(code.length / 2);
  return `${code.slice(0, half)} ${code.slice(half)}`;
}
