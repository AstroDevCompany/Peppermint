// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/**
 * Windows only: fail before the build when the object directory is too deep.
 *
 * mozmake stats object files by a relative path (../../../third_party/...)
 * resolved against its working directory, and Windows applies MAX_PATH (260)
 * to that unnormalised string. libxul is linked from <objdir>/toolkit/library/
 * build, and the deepest libwebrtc objects sit ~170 characters below the
 * objdir, so a checkout that looks fine for hours of compiling fails at the
 * very end with "No rule to make target ... needed by xul.dll".
 *
 * The check measures the real source tree (the deepest gn directory below the
 * libraries that are linked into libxul), so it keeps working as libwebrtc
 * grows. It never runs on macOS or Linux, and cross builds on Linux do not
 * have the limit.
 *
 * Set PEPPERMINT_SKIP_PATH_CHECK=1 to bypass (for example when long paths are
 * known to work on the machine).
 */

import fs from "node:fs";
import path from "node:path";
import { engineDir } from "./lib.mjs";

const MAX_PATH = 260;
// "Unified_cpp_" + up to 17 characters of the library name + "0.obj".
const UNIFIED_OBJECT_LENGTH = 36;
// "../../../" from toolkit/library/build up to the objdir.
const RELATIVE_PREFIX_LENGTH = "../../../".length;
const LINK_DIR = "toolkit/library/build";
const MARGIN = 4;
// Trees that contribute generated "..._gn" libraries linked into libxul.
const DEEP_TREES = [
  "third_party/libwebrtc",
  "third_party/abseil-cpp",
  "third_party/angle",
];

function configuredObjdir() {
  const mozconfig = path.join(engineDir, "mozconfig");
  if (!fs.existsSync(mozconfig)) {
    return null;
  }
  const lines = fs.readFileSync(mozconfig, "utf8").split(/\r?\n/);
  for (const line of lines.reverse()) {
    const match = /^mk_add_options MOZ_OBJDIR=(.+)$/.exec(line.trim());
    if (match) {
      return match[1].replace(/^"|"$/g, "").replace("@TOPSRCDIR@", engineDir);
    }
  }
  return null;
}

function objdirPath() {
  const explicit = configuredObjdir();
  if (explicit) {
    return path.resolve(explicit);
  }
  const existing = fs.existsSync(engineDir)
    ? fs.readdirSync(engineDir).find(name => /^obj-.*windows-msvc$/.test(name))
    : null;
  if (existing) {
    return path.join(engineDir, existing);
  }
  const arch = process.env.SURFER_COMPAT === "aarch64" ? "aarch64" : "x86_64";
  return path.join(engineDir, `obj-${arch}-pc-windows-msvc`);
}

/** Length of the longest "<dir>/<unified object>" below the deep trees. */
function deepestObjectLength() {
  let deepest = 0;
  const walk = (dir, relative) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    if (entries.some(entry => entry.isFile() && entry.name === "moz.build")) {
      deepest = Math.max(
        deepest,
        relative.length + 1 + UNIFIED_OBJECT_LENGTH
      );
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        walk(path.join(dir, entry.name), `${relative}/${entry.name}`);
      }
    }
  };
  for (const tree of DEEP_TREES) {
    walk(path.join(engineDir, ...tree.split("/")), tree);
  }
  return deepest;
}

function main() {
  if (process.platform !== "win32" || process.env.PEPPERMINT_SKIP_PATH_CHECK) {
    return 0;
  }
  if (!fs.existsSync(engineDir)) {
    return 0;
  }
  const deepest = deepestObjectLength();
  if (!deepest) {
    return 0;
  }

  const objdir = objdirPath();
  const cwd = `${objdir}\\${LINK_DIR.replace(/\//g, "\\")}\\`;
  const needed = cwd.length + RELATIVE_PREFIX_LENGTH + deepest;
  const limit = MAX_PATH - 1 - MARGIN;
  if (needed <= limit) {
    return 0;
  }

  const over = needed - limit;
  console.error(
    [
      "",
      "Path too long for the Windows build.",
      `  object directory : ${objdir} (${objdir.length} characters)`,
      `  longest lookup   : ${needed} characters, limit ${limit} (MAX_PATH ${MAX_PATH})`,
      "",
      "mozmake would fail at the very end of the compile with",
      '"No rule to make target ... needed by xul.dll" because Windows cannot',
      "open the longest libwebrtc object paths.",
      "",
      `Shorten the object directory by at least ${over} characters. Either:`,
      "  1. Move the checkout to a short path such as C:\\pm, or",
      "  2. Keep the checkout and add this line to the local `mozconfig` in the",
      "     repository root (a short folder on any drive):",
      "         mk_add_options MOZ_OBJDIR=C:/pm-obj",
      "",
      "Either change needs one full rebuild. Set PEPPERMINT_SKIP_PATH_CHECK=1",
      "to bypass this check.",
      "",
    ].join("\n")
  );
  return 1;
}

process.exit(main());
