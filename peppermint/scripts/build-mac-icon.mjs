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
 *  - document.icns: the icon Finder shows for files Peppermint opens (PDF,
 *    HTML, JSON...), a page with a folded corner carrying the logo. Without
 *    it the build falls back to Firefox's stock document icon.
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

const PAGE_W = 720;
const PAGE_H = 944;
const FOLD = 230;
const FOLD_COLOR = "#2fa89a";
const ICNS_SIZES = [16, 32, 128, 256, 512];

async function documentIcon(logo, output) {
  const left = (CANVAS - PAGE_W) / 2;
  const top = (CANVAS - PAGE_H) / 2;
  const edge = left + PAGE_W;
  const page = `M${left} ${top} H${edge - FOLD} L${edge} ${top + FOLD} V${top + PAGE_H} H${left} Z`;
  const fold = `M${edge - FOLD} ${top} L${edge} ${top + FOLD} H${edge - FOLD + 40} Q${edge - FOLD} ${top + FOLD} ${edge - FOLD} ${top + FOLD - 40} Z`;
  const svg = (body) =>
    Buffer.from(`<svg width="${CANVAS}" height="${CANVAS}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`);
  const shadow = await sharp(
    svg(`<path d="${page}" transform="translate(0 12)" fill="rgba(0,0,0,0.28)"/>`)
  )
    .blur(14)
    .png()
    .toBuffer();
  const size = 600;
  const art = await sharp(logo)
    .resize(size, size)
    .composite([
      {
        input: Buffer.from(
          `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${size * 0.22}" fill="#fff"/></svg>`
        ),
        blend: "dest-in",
      },
    ])
    .png()
    .toBuffer();
  await sharp(shadow)
    .composite([
      { input: svg(`<path d="${page}" fill="rgb(254,253,249)" stroke="rgba(0,0,0,0.12)" stroke-width="2"/>`) },
      { input: art, left: Math.round((CANVAS - size) / 2), top: top + 270 },
      { input: svg(`<path d="${fold}" fill="${FOLD_COLOR}"/>`) },
    ])
    .png()
    .toFile(output);
}

async function writeIcns(source, output, work) {
  const iconset = path.join(work, "document.iconset");
  fs.mkdirSync(iconset, { recursive: true });
  for (const size of ICNS_SIZES) {
    await sharp(source).resize(size, size).toFile(path.join(iconset, `icon_${size}x${size}.png`));
    if (size * 2 <= CANVAS) {
      await sharp(source)
        .resize(size * 2, size * 2)
        .toFile(path.join(iconset, `icon_${size}x${size}@2x.png`));
    }
  }
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", output]);
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
    const doc = path.join(out, "document.png");
    await documentIcon(layer, doc);
    await writeIcns(doc, path.join(dir, "document.icns"), out);
    console.log(`${brand}: wrote Assets.car, logo-mac.png and document.icns`);
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
