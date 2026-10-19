// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/**
 * Regenerate the macOS app icon from configs/branding/<brand>/logo1024.png.
 *
 *   node peppermint/scripts/build-mac-icon.mjs
 *
 * macOS 26 draws its own squircle, shadow and glass around an app icon that
 * ships as an Icon Composer asset (Assets.car, selected by CFBundleIconName).
 * An icon that only has a .icns is treated as a legacy icon and is shrunk
 * onto a dark plate. So this writes, for each brand:
 *
 *  - Assets.car: logo on a full-bleed square (no baked-in corners), compiled
 *    from peppermint/branding/macos/AppIcon.icon with actool (needs Xcode).
 *  - logo-mac.png: the pre-Tahoe squircle icon with padding and a soft shadow.
 *    The import turns it into firefox.icns.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { root } from "./lib.mjs";

const ICON = path.join(root, "peppermint/branding/macos/AppIcon.icon");
const BRANDS = ["release", "twilight"];
const BACKGROUND = { r: 254, g: 253, b: 249, alpha: 1 };
const CANVAS = 1024;
const ART = 824;
const OFFSET = (CANVAS - ART) / 2;
const RADIUS = 185;

async function fullBleed(source, output) {
  await sharp({
    create: { width: CANVAS, height: CANVAS, channels: 4, background: BACKGROUND },
  })
    .composite([{ input: source }])
    .flatten({ background: BACKGROUND })
    .png()
    .toFile(output);
}

async function legacySquircle(fullBleedFile, output) {
  const rect = (attrs, size) =>
    Buffer.from(
      `<svg width="${size}" height="${size}"><rect ${attrs} rx="${RADIUS}" ry="${RADIUS}"/></svg>`
    );
  const art = await sharp(fullBleedFile)
    .resize(ART, ART)
    .composite([{ input: rect(`width="${ART}" height="${ART}"`, ART), blend: "dest-in" }])
    .png()
    .toBuffer();
  const shadow = await sharp({
    create: {
      width: CANVAS,
      height: CANVAS,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: rect(
          `x="${OFFSET}" y="${OFFSET + 10}" width="${ART}" height="${ART}" fill="rgba(0,0,0,0.3)"`,
          CANVAS
        ),
      },
    ])
    .blur(12)
    .png()
    .toBuffer();
  await sharp(shadow)
    .composite([{ input: art, left: OFFSET, top: OFFSET }])
    .png()
    .toFile(output);
}

function compile(outDir) {
  execFileSync(
    "xcrun",
    [
      "actool",
      ICON,
      "--compile",
      outDir,
      "--output-format",
      "human-readable-text",
      "--output-partial-info-plist",
      path.join(outDir, "partial.plist"),
      "--app-icon",
      "AppIcon",
      "--platform",
      "macosx",
      "--target-device",
      "mac",
      "--minimum-deployment-target",
      "26.0",
    ],
    { stdio: "inherit" }
  );
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "mac-icon-"));
try {
  for (const brand of BRANDS) {
    const dir = path.join(root, "configs/branding", brand);
    const layer = path.join(ICON, "Assets/peppermint.png");
    await fullBleed(path.join(dir, "logo1024.png"), layer);
    await legacySquircle(layer, path.join(dir, "logo-mac.png"));
    const out = path.join(work, brand);
    fs.mkdirSync(out);
    compile(out);
    fs.copyFileSync(path.join(out, "Assets.car"), path.join(dir, "Assets.car"));
    console.log(`${brand}: wrote Assets.car and logo-mac.png`);
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
