/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Small developer tools the address bar answers to. A tool runs when the
 * search starts with one of its keywords ("jwt eyJ...") or, for colors, when
 * the whole search is a color. Each answer is `{ kind, value }`; `kind` names
 * the label in peppermint-omni-utils.ftl.
 */

const MAX_INPUT_LENGTH = 20000;
const MAX_UUIDS = 10;
const MAX_WORDS = 500;
const PASSWORD_LENGTH = { min: 4, max: 128, default: 20 };
const PASSWORD_ALPHABET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*-_=+?";
const LOREM =
  "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat".split(
    " "
  );
const HASH_ALGORITHMS = {
  sha1: "SHA-1",
  sha256: "SHA-256",
  sha512: "SHA-512",
};

// Seconds and milliseconds since 1970 are told apart by size: 1e11 seconds is
// the year 5138, 1e11 milliseconds is 1973.
const MILLISECONDS_THRESHOLD = 1e11;

const encoder = new TextEncoder();

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * @param {string} text - Base64 or base64url, with or without padding
 * @returns {string|null} The UTF-8 text it stands for, or null when it is not
 *   valid base64 or not readable text
 */
export function decodeBase64Text(text) {
  const normalized = text
    .replace(/\s+/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  if (
    !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) ||
    normalized.length % 4 == 1
  ) {
    return null;
  }
  try {
    const binary = atob(normalized.replace(/=+$/, ""));
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    // eslint-disable-next-line no-control-regex
    return /[\u0000-\u0008\u000e-\u001f]/.test(decoded) ? null : decoded;
  } catch {
    return null;
  }
}

function randomInt(max) {
  const limit = Math.floor(0x100000000 / max) * max;
  const sample = new Uint32Array(1);
  do {
    crypto.getRandomValues(sample);
  } while (sample[0] >= limit);
  return sample[0] % max;
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer), byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function parseCount(args, fallback, min, max) {
  if (!args) {
    return fallback;
  }
  if (!/^\d+$/.test(args)) {
    return null;
  }
  return Math.min(max, Math.max(min, parseInt(args, 10)));
}

function rgbToHsl(r, g, b) {
  const [red, green, blue] = [r / 255, g / 255, b / 255];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (!delta) {
    return [0, 0, Math.round(lightness * 100)];
  }
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue;
  if (max === red) {
    hue = ((green - blue) / delta) % 6;
  } else if (max === green) {
    hue = (blue - red) / delta + 2;
  } else {
    hue = (red - green) / delta + 4;
  }
  return [
    Math.round((hue * 60 + 360) % 360),
    Math.round(saturation * 100),
    Math.round(lightness * 100),
  ];
}

function hslToRgb(h, s, l) {
  const [saturation, lightness] = [s / 100, l / 100];
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const hue = (((h % 360) + 360) % 360) / 60;
  const x = chroma * (1 - Math.abs((hue % 2) - 1));
  const sectors = [
    [chroma, x, 0],
    [x, chroma, 0],
    [0, chroma, x],
    [0, x, chroma],
    [x, 0, chroma],
    [chroma, 0, x],
  ];
  const [r, g, b] = sectors[Math.min(5, Math.floor(hue))];
  const offset = lightness - chroma / 2;
  return [r, g, b].map(channel => Math.round((channel + offset) * 255));
}

/**
 * @param {string} text - "#f60", "#ff6600", "#ff660080", "rgb(255 102 0)",
 *   "rgba(255, 102, 0, .5)" or "hsl(24, 100%, 50%)"
 * @returns {{r: number, g: number, b: number, a: number}|null}
 */
export function parseColor(text) {
  const value = text.trim().toLowerCase();
  const hex = value.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (hex) {
    let digits = hex[1];
    if (digits.length <= 4) {
      digits = Array.from(digits, digit => digit + digit).join("");
    }
    const [r, g, b, a = 255] = digits
      .match(/../g)
      .map(pair => parseInt(pair, 16));
    return { r, g, b, a: Math.round((a / 255) * 100) / 100 };
  }
  const functional = value.match(/^(rgba?|hsla?)\(\s*([^)]*?)\s*\)$/);
  if (!functional) {
    return null;
  }
  const parts = functional[2].split(/\s*[,/]\s*|\s+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) {
    return null;
  }
  const numbers = parts.map(part => parseFloat(part));
  if (numbers.some(Number.isNaN)) {
    return null;
  }
  let alpha = 1;
  if (parts[3] !== undefined) {
    alpha = parts[3].endsWith("%") ? numbers[3] / 100 : numbers[3];
  }
  if (alpha < 0 || alpha > 1) {
    return null;
  }
  if (functional[1].startsWith("rgb")) {
    if (numbers.slice(0, 3).some(channel => channel < 0 || channel > 255)) {
      return null;
    }
    const [r, g, b] = numbers.slice(0, 3).map(Math.round);
    return { r, g, b, a: alpha };
  }
  const [h, s, l] = numbers;
  if (s < 0 || s > 100 || l < 0 || l > 100) {
    return null;
  }
  const [r, g, b] = hslToRgb(h, s, l);
  return { r, g, b, a: alpha };
}

function colorResults(color) {
  const { r, g, b, a } = color;
  const [h, s, l] = rgbToHsl(r, g, b);
  const alphaHex =
    a < 1
      ? Math.round(a * 255)
          .toString(16)
          .padStart(2, "0")
      : "";
  const hex = `#${[r, g, b].map(c => c.toString(16).padStart(2, "0")).join("")}${alphaHex}`;
  const rgb = a < 1 ? `rgba(${r}, ${g}, ${b}, ${a})` : `rgb(${r}, ${g}, ${b})`;
  const hsl =
    a < 1 ? `hsla(${h}, ${s}%, ${l}%, ${a})` : `hsl(${h}, ${s}%, ${l}%)`;
  return [
    { kind: "color-hex", value: hex },
    { kind: "color-rgb", value: rgb },
    { kind: "color-hsl", value: hsl },
  ];
}

function base64Tool(args) {
  if (!args) {
    return [];
  }
  const results = [
    { kind: "base64-encoded", value: bytesToBase64(encoder.encode(args)) },
  ];
  const decoded = decodeBase64Text(args);
  if (decoded !== null) {
    results.unshift({ kind: "base64-decoded", value: decoded });
  }
  return results;
}

function urlEncodeTool(args) {
  return args ? [{ kind: "url-encoded", value: encodeURIComponent(args) }] : [];
}

function urlDecodeTool(args) {
  try {
    return args
      ? [{ kind: "url-decoded", value: decodeURIComponent(args) }]
      : [];
  } catch {
    return [];
  }
}

function parseJwtSegment(segment) {
  const text = decodeBase64Text(segment);
  if (text === null) {
    return null;
  }
  try {
    const value = JSON.parse(text);
    return value && typeof value == "object" ? value : null;
  } catch {
    return null;
  }
}

function jwtTool(args) {
  const parts = args.trim().split(".");
  if (parts.length < 2 || parts.length > 3) {
    return [];
  }
  const header = parseJwtSegment(parts[0]);
  const payload = parseJwtSegment(parts[1]);
  if (!header || !payload) {
    return [];
  }
  const results = [
    { kind: "jwt-payload", value: JSON.stringify(payload) },
    { kind: "jwt-header", value: JSON.stringify(header) },
  ];
  const now = Date.now();
  if (typeof payload.exp == "number") {
    results.push({
      kind: payload.exp * 1000 < now ? "jwt-expired" : "jwt-expires",
      value: new Date(payload.exp * 1000).toISOString(),
    });
  }
  if (typeof payload.iat == "number") {
    results.push({
      kind: "jwt-issued",
      value: new Date(payload.iat * 1000).toISOString(),
    });
  }
  return results;
}

function timestampTool(args) {
  const text = args.trim().toLowerCase();
  if (!text || text == "now") {
    const now = Date.now();
    return [
      { kind: "timestamp-seconds", value: String(Math.floor(now / 1000)) },
      { kind: "timestamp-milliseconds", value: String(now) },
      { kind: "timestamp-utc", value: new Date(now).toISOString() },
    ];
  }
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    const number = parseFloat(text);
    const milliseconds =
      Math.abs(number) >= MILLISECONDS_THRESHOLD ? number : number * 1000;
    const date = new Date(milliseconds);
    if (Number.isNaN(date.getTime())) {
      return [];
    }
    return [
      { kind: "timestamp-utc", value: date.toISOString() },
      { kind: "timestamp-local", value: date.toString() },
    ];
  }
  const parsed = Date.parse(args.trim());
  if (Number.isNaN(parsed)) {
    return [];
  }
  return [
    { kind: "timestamp-seconds", value: String(Math.floor(parsed / 1000)) },
    { kind: "timestamp-milliseconds", value: String(parsed) },
  ];
}

function uuidTool(args) {
  const count = parseCount(args.trim(), 1, 1, MAX_UUIDS);
  if (count === null) {
    return [];
  }
  return Array.from({ length: count }, () => ({
    kind: "uuid",
    value: crypto.randomUUID(),
  }));
}

async function hashTool(args, keyword) {
  if (!args) {
    return [];
  }
  const digest = await crypto.subtle.digest(
    HASH_ALGORITHMS[keyword],
    encoder.encode(args)
  );
  return [{ kind: `hash-${keyword}`, value: toHex(digest) }];
}

function passwordTool(args) {
  const { min, max, default: fallback } = PASSWORD_LENGTH;
  const length = parseCount(args.trim(), fallback, min, max);
  if (length === null) {
    return [];
  }
  let password = "";
  for (let i = 0; i < length; i++) {
    password += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  }
  return [{ kind: "password", value: password }];
}

function loremTool(args) {
  const count = parseCount(args.trim(), 25, 1, MAX_WORDS);
  if (count === null) {
    return [];
  }
  const words = Array.from(
    { length: count },
    (_, i) => LOREM[i % LOREM.length]
  );
  words[0] = words[0][0].toUpperCase() + words[0].slice(1);
  return [{ kind: "lorem", value: `${words.join(" ")}.` }];
}

function jsonTool(args) {
  let parsed;
  try {
    parsed = JSON.parse(args);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed != "object") {
    return [];
  }
  return [
    { kind: "json-formatted", value: JSON.stringify(parsed, null, 2) },
    { kind: "json-minified", value: JSON.stringify(parsed) },
  ];
}

function colorTool(args) {
  const color = parseColor(args);
  return color ? colorResults(color) : [];
}

const KEYWORD_TOOLS = new Map([
  ["b64", base64Tool],
  ["base64", base64Tool],
  ["urlenc", urlEncodeTool],
  ["urlencode", urlEncodeTool],
  ["urldec", urlDecodeTool],
  ["urldecode", urlDecodeTool],
  ["jwt", jwtTool],
  ["ts", timestampTool],
  ["epoch", timestampTool],
  ["timestamp", timestampTool],
  ["uuid", uuidTool],
  ["pw", passwordTool],
  ["lorem", loremTool],
  ["json", jsonTool],
  ...Object.keys(HASH_ALGORITHMS).map(name => [name, hashTool]),
]);

/**
 * @param {string} input - What was typed in the address bar
 * @returns {{run: () => (object[]|Promise<object[]>)}|null} The tool the
 *   input is meant for, or null when it is an ordinary search
 */
export function matchOmniTool(input) {
  const text = input.trim();
  if (!text || text.length > MAX_INPUT_LENGTH) {
    return null;
  }
  const keyword = text.split(/\s+/, 1)[0].toLowerCase();
  const tool = KEYWORD_TOOLS.get(keyword);
  if (tool) {
    const args = text.slice(keyword.length).trim();
    return { run: () => tool(args, keyword) };
  }
  if (/^(#|rgba?\(|hsla?\()/i.test(text) && parseColor(text)) {
    return { run: () => colorTool(text) };
  }
  return null;
}

/**
 * @param {string} input - What was typed in the address bar
 * @returns {Promise<{kind: string, value: string}[]>} The answers, none when
 *   the input is not for a tool
 */
export async function omniResults(input) {
  const match = matchOmniTool(input);
  return match ? await match.run() : [];
}
