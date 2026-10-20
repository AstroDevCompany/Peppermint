/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { PeppermintUpdater, UpdateStatus, isNewerVersion, pickRelease } =
  ChromeUtils.importESModule(
    "moz-src:///peppermint/updater/PeppermintUpdater.sys.mjs"
  );

const URLS = {
  macos: "https://example.com/Peppermint.dmg",
  windows: "https://example.com/installer.exe",
  linux: "https://example.com/peppermint.tar.xz",
};

add_setup(async function () {
  // Let the window finish its start-up animations first.
  await new Promise(resolve => setTimeout(resolve, 500));
});

function manifestUrl(manifest) {
  return `data:application/json,${encodeURIComponent(JSON.stringify(manifest))}`;
}

async function checkWith(manifest) {
  await SpecialPowers.pushPrefEnv({
    set: [["peppermint.update.url", manifestUrl(manifest)]],
  });
  return PeppermintUpdater.checkNow();
}

add_task(function test_version_comparison() {
  Assert.ok(isNewerVersion("2026.0.1", "2026.0.2"), "Patch bump is newer");
  Assert.ok(isNewerVersion("2026.0.9", "2026.0.10"), "Numeric, not textual");
  Assert.ok(isNewerVersion("2026.9.0", "2027.0.0"), "Year bump is newer");
  Assert.ok(!isNewerVersion("2026.0.2", "2026.0.2"), "Same is not newer");
  Assert.ok(!isNewerVersion("2026.0.2", "2026.0.1"), "Older is not newer");
  Assert.ok(!isNewerVersion("2026.0.2", ""), "Empty is not newer");
  Assert.ok(!isNewerVersion("2026.0.2", "latest"), "Junk is not newer");
  Assert.ok(!isNewerVersion("2026.0.2", null), "Missing is not newer");
});

add_task(function test_pick_release() {
  const json = { latest: "2026.0.3", downloads: URLS };
  const mac = pickRelease(json, "macosx", "aarch64-gcc3");
  Assert.equal(mac.url, URLS.macos, "macOS gets the dmg, any CPU");
  Assert.equal(mac.version, "2026.0.3");
  Assert.equal(
    pickRelease(json, "win", "x86_64-msvc").url,
    URLS.windows,
    "Windows x64 gets the installer"
  );
  Assert.equal(
    pickRelease(json, "win", "aarch64-msvc"),
    null,
    "Windows ARM never gets the x64 installer"
  );
  Assert.equal(
    pickRelease(
      { latest: "2026.0.3", downloads: { "windows-arm64": URLS.windows } },
      "win",
      "aarch64-msvc"
    ).url,
    URLS.windows,
    "Windows ARM uses its own key"
  );
  Assert.equal(
    pickRelease(json, "linux", "x86_64-gcc3").url,
    URLS.linux,
    "Linux x64 gets the tarball"
  );
  Assert.equal(
    pickRelease(
      { latest: "2026.0.3", downloads: { ...URLS, linux: "" } },
      "linux",
      "x86_64-gcc3"
    ),
    null,
    "An empty link means no release for that platform"
  );
  Assert.equal(
    pickRelease({ latest: "2026.0.3", downloads: {} }, "macosx"),
    null,
    "A missing link means no release for that platform"
  );
  Assert.equal(
    pickRelease(
      { latest: "2026.0.3", downloads: { macos: "http://example.com/a.dmg" } },
      "macosx"
    ),
    null,
    "Plain http is refused"
  );
  Assert.equal(pickRelease(null, "macosx"), null, "No manifest");
  Assert.equal(pickRelease({ downloads: URLS }, "macosx"), null, "No version");
  const hash = "a".repeat(64);
  Assert.equal(
    pickRelease(
      { latest: "2026.0.3", downloads: URLS, sha256: { macos: hash } },
      "macosx"
    ).sha256,
    hash,
    "A checksum is passed on"
  );
});

add_task(async function test_up_to_date() {
  const state = await checkWith({
    latest: Services.appinfo.version,
    downloads: URLS,
  });
  Assert.equal(state.status, UpdateStatus.UP_TO_DATE, "Same version");
});

add_task(async function test_no_download_for_this_platform() {
  const state = await checkWith({ latest: "9999.0.0", downloads: {} });
  Assert.equal(
    state.status,
    UpdateStatus.UP_TO_DATE,
    "Nothing published for this platform means nothing to offer"
  );
});

add_task(async function test_newer_version_is_offered() {
  const seen = [];
  const observer = (subject, topic, status) => seen.push(status);
  Services.obs.addObserver(observer, "peppermint-update-state");
  // Match this machine whichever platform the test runs on.
  const downloads = {
    ...URLS,
    "windows-arm64": URLS.windows,
    "linux-aarch64": URLS.linux,
  };
  const state = await checkWith({ latest: "9999.0.0", downloads });
  Services.obs.removeObserver(observer, "peppermint-update-state");
  Assert.equal(state.status, UpdateStatus.MANUAL, "Auto download is off");
  Assert.equal(state.version, "9999.0.0");
  Assert.ok(state.url.startsWith("https://example.com/"), "Download link");
  Assert.deepEqual(
    seen,
    [UpdateStatus.CHECKING, UpdateStatus.MANUAL],
    "Listeners are told about every step"
  );
});

add_task(async function test_bad_manifest() {
  await SpecialPowers.pushPrefEnv({
    set: [["peppermint.update.url", "data:application/json,not-json"]],
  });
  const state = await PeppermintUpdater.checkNow();
  Assert.equal(state.status, UpdateStatus.FAILED, "Junk is a failed check");
});

add_task(async function test_about_dialog() {
  Assert.equal(
    Services.appinfo.version,
    "2026.0.2",
    "The app reports Peppermint's own version"
  );
  const dialog = window.openDialog(
    "chrome://browser/content/aboutDialog.xhtml",
    "",
    "chrome,dialog=no,centerscreen"
  );
  await BrowserTestUtils.waitForEvent(dialog, "load");
  const doc = dialog.document;
  Assert.ok(
    doc.getElementById("peppermintUpdateButton"),
    "The About dialog has the update button"
  );
  Assert.ok(
    !doc.getElementById("checkForUpdatesButton"),
    "Firefox's own update widgets are gone"
  );
  Assert.ok(
    doc.getElementById("version").getAttribute("data-l10n-args").includes(
      "2026.0.2"
    ),
    "The About dialog shows the version"
  );
  dialog.close();
});
