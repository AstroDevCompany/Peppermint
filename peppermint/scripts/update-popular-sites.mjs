// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/**
 * Regenerate src/peppermint/urlbar/popular-sites.json, the ranked list of
 * domains the address bar suggests for sites the user has never visited.
 *
 *   node peppermint/scripts/update-popular-sites.mjs [--limit 10000] [--crux-max 100000]
 *
 * The order comes from the Tranco ranking (https://tranco-list.eu). Tranco
 * also ranks infrastructure domains that nobody navigates to (CDNs, DNS and
 * tracking hosts), so a domain is kept only when the Chrome UX Report
 * (https://github.com/zakird/crux-top-lists) shows real page loads for it,
 * as the domain itself or its www host.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { root } from "./lib.mjs";

const TRANCO_URL = "https://tranco-list.eu/top-1m.csv.zip";
const CRUX_URL =
  "https://raw.githubusercontent.com/zakird/crux-top-lists/main/data/global/current.csv.gz";
const OUTPUT = path.join(root, "src/peppermint/urlbar/popular-sites.json");

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index == -1 ? fallback : Number(process.argv[index + 1]);
}

function download(url, file) {
  execFileSync("curl", ["-sSfL", "--max-time", "300", "-o", file, url]);
}

const limit = option("limit", 10000);
const cruxMax = option("crux-max", 100000);
const work = fs.mkdtempSync(path.join(os.tmpdir(), "popular-sites-"));

try {
  download(TRANCO_URL, path.join(work, "tranco.zip"));
  download(CRUX_URL, path.join(work, "crux.csv.gz"));
  execFileSync("unzip", [
    "-q",
    "-o",
    path.join(work, "tranco.zip"),
    "-d",
    work,
  ]);
  execFileSync("gunzip", ["-f", path.join(work, "crux.csv.gz")]);

  const visited = new Set();
  for (const line of fs
    .readFileSync(path.join(work, "crux.csv"), "utf8")
    .split("\n")
    .slice(1)) {
    const comma = line.lastIndexOf(",");
    if (comma == -1 || Number(line.slice(comma + 1)) > cruxMax) {
      continue;
    }
    visited.add(line.slice(0, comma).replace(/^https?:\/\//, ""));
  }

  const domains = [];
  for (const line of fs
    .readFileSync(path.join(work, "top-1m.csv"), "utf8")
    .split("\n")) {
    const domain = line.slice(line.indexOf(",") + 1).trim();
    if (
      domain &&
      /^[a-z0-9.-]+$/.test(domain) &&
      (visited.has(domain) || visited.has(`www.${domain}`))
    ) {
      domains.push(domain);
      if (domains.length == limit) {
        break;
      }
    }
  }

  fs.writeFileSync(OUTPUT, JSON.stringify(domains) + "\n");
  console.log(
    `Wrote ${domains.length} domains to ${path.relative(root, OUTPUT)}`
  );
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
