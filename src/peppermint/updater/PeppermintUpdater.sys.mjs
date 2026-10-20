// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/**
 * Peppermint's update system. It replaces the MAR updater: the browser reads
 * a small JSON file from GitHub, compares its "latest" with its own version,
 * downloads the installer for this platform in the background and swaps the
 * app on restart.
 *
 *   {
 *     "latest": "2026.0.2",
 *     "downloads": { "macos": "<.dmg>", "windows": "<.exe>", "linux": "<.tar.xz>" }
 *   }
 *
 * An empty or missing download means there is no release for that platform.
 * Optional extras: "windows-arm64" and "linux-aarch64" downloads for ARM
 * machines, and "sha256": { "<download key>": "<hex>" } to verify a file.
 *
 * The state is exposed through PeppermintUpdater.state and announced with the
 * "peppermint-update-state" observer topic, so the sidebar notification and
 * the About dialog never keep a second copy of it.
 */

import { AppConstants } from "resource://gre/modules/AppConstants.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  Downloads: "resource://gre/modules/Downloads.sys.mjs",
  Subprocess: "resource://gre/modules/Subprocess.sys.mjs",
  clearTimeout: "resource://gre/modules/Timer.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
});

export const UPDATE_STATE_TOPIC = "peppermint-update-state";

const PREF_ENABLED = "peppermint.update.enabled";
const PREF_URL = "peppermint.update.url";
const PREF_INTERVAL = "peppermint.update.interval-seconds";
const PREF_AUTO_DOWNLOAD = "peppermint.update.auto-download";
const PREF_ALLOW_DEV_INSTALL = "peppermint.update.allow-dev-install";
const PREF_STAGED_VERSION = "peppermint.update.staged-version";
const PREF_STAGED_PATH = "peppermint.update.staged-path";
const PREF_LAST_CHECK = "peppermint.update.last-check";

const STARTUP_DELAY_MS = 30 * 1000;
const FETCH_TIMEOUT_MS = 20 * 1000;
const MIN_INTERVAL_SECONDS = 600;
const UPDATE_DIR_NAME = "peppermint-update";

/** The file type that can be installed in place on each platform. */
const INSTALLABLE_EXTENSION = {
  macosx: ".dmg",
  win: ".exe",
  linux: ".tar.xz",
};

const Status = Object.freeze({
  IDLE: "idle",
  CHECKING: "checking",
  UP_TO_DATE: "up-to-date",
  DOWNLOADING: "downloading",
  READY: "ready",
  // A newer version exists, but this install cannot update itself
  // (read-only location, development build, unknown file type).
  MANUAL: "manual",
  FAILED: "failed",
});

export const UpdateStatus = Status;

// Pure helpers. They are exported for the tests.

/**
 * True when `latest` is a valid, strictly newer version than `current`.
 *
 * @param {string} current - The running version.
 * @param {*} latest - The version from the JSON.
 * @returns {boolean}
 */
export function isNewerVersion(current, latest) {
  return (
    typeof latest == "string" &&
    /^\d+(\.\d+){0,3}$/.test(latest) &&
    Services.vc.compare(current, latest) < 0
  );
}

/**
 * The key of the "downloads" map for this machine, or null when none can be
 * used. ARM builds only ever get an ARM file: handing them an x64 installer
 * would swap the app for the wrong architecture.
 *
 * @param {string} [platform] - AppConstants.platform value.
 * @param {string} [abi] - Services.appinfo.XPCOMABI value.
 * @returns {string|null}
 */
export function downloadKey(platform = AppConstants.platform, abi) {
  const arm = /^(aarch64|arm64)/i.test(abi ?? Services.appinfo.XPCOMABI);
  switch (platform) {
    case "macosx":
      return "macos";
    case "win":
      return arm ? "windows-arm64" : "windows";
    case "linux":
      return arm ? "linux-aarch64" : "linux";
  }
  return null;
}

/**
 * The validated release for this machine from the parsed JSON, or null when
 * the JSON is malformed or there is no download for this platform.
 *
 * @param {object} json - The parsed update JSON.
 * @param {string} [platform] - AppConstants.platform value.
 * @param {string} [abi] - Services.appinfo.XPCOMABI value.
 * @returns {{version: string, key: string, url: string, sha256: string|null}|null}
 */
export function pickRelease(json, platform, abi) {
  if (!json || typeof json.latest != "string") {
    return null;
  }
  const key = downloadKey(platform, abi);
  const raw = key && json.downloads?.[key];
  if (typeof raw != "string" || !raw) {
    return null;
  }
  // Checked on the text itself, before URL parsing can normalise the scheme.
  if (!/^https:\/\//i.test(raw)) {
    return null;
  }
  let url;
  try {
    url = new URL(raw);
  } catch (e) {
    return null;
  }
  if (url.protocol != "https:") {
    return null;
  }
  const sha = json.sha256?.[key];
  return {
    version: json.latest,
    key,
    url: url.href,
    sha256:
      typeof sha == "string" && /^[0-9a-f]{64}$/i.test(sha)
        ? sha.toLowerCase()
        : null,
  };
}

function fileExtensionOf(url) {
  const path = new URL(url).pathname.toLowerCase();
  return path.endsWith(".tar.xz")
    ? ".tar.xz"
    : (path.match(/\.[a-z0-9]+$/)?.[0] ?? "");
}

function localFile(path) {
  const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  file.initWithPath(path);
  return file;
}

async function run(command, args) {
  const proc = await lazy.Subprocess.call({
    command,
    arguments: args,
    stderr: "stdout",
  });
  let output = "";
  let chunk;
  while ((chunk = await proc.stdout.readString())) {
    output += chunk;
  }
  const { exitCode } = await proc.wait();
  if (exitCode !== 0) {
    throw new Error(`${command} exited with ${exitCode}: ${output.trim()}`);
  }
  return output;
}

/**
 * Launches a program that keeps running after this one quits.
 *
 * @param {string} command - Path of the program.
 * @param {string[]} args - Its arguments.
 */
function spawnDetached(command, args) {
  const process = Cc["@mozilla.org/process/util;1"].createInstance(
    Ci.nsIProcess
  );
  process.init(localFile(command));
  process.runAsync(args, args.length);
}

async function readIniVersion(iniPath) {
  try {
    const text = await IOUtils.readUTF8(iniPath);
    return text.match(/^Version=(.+)$/m)?.[1]?.trim() ?? null;
  } catch (e) {
    return null;
  }
}

class Updater {
  #state = { status: Status.IDLE, version: null, url: null, progress: 0 };
  #timer = null;
  #started = false;
  #busy = null;
  #download = null;

  get state() {
    return { ...this.#state };
  }

  get currentVersion() {
    return Services.appinfo.version;
  }

  get enabled() {
    return Services.prefs.getBoolPref(PREF_ENABLED, true);
  }

  /** Starts the check schedule. Safe to call from every window. */
  init() {
    if (this.#started || !this.enabled) {
      return;
    }
    if (Cu.isInAutomation || Services.env.get("MOZ_HEADLESS")) {
      return;
    }
    this.#started = true;
    this.cleanupInstalled().catch(console.error);
    this.#scheduleCheck(STARTUP_DELAY_MS);
  }

  /** Checks now. Concurrent calls share one check. */
  checkNow() {
    if (!this.enabled) {
      return Promise.resolve(this.state);
    }
    this.#busy ??= this.#check().finally(() => {
      this.#busy = null;
    });
    return this.#busy;
  }

  #scheduleCheck(delayMs) {
    lazy.clearTimeout(this.#timer);
    this.#timer = lazy.setTimeout(async () => {
      await this.checkNow();
      const seconds = Math.max(
        Services.prefs.getIntPref(PREF_INTERVAL, 21600),
        MIN_INTERVAL_SECONDS
      );
      this.#scheduleCheck(seconds * 1000);
    }, delayMs);
  }

  #set(patch) {
    this.#state = { ...this.#state, ...patch };
    Services.obs.notifyObservers(null, UPDATE_STATE_TOPIC, this.#state.status);
  }

  async #fetchManifest() {
    const controller = new AbortController();
    const timeout = lazy.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(Services.prefs.getStringPref(PREF_URL), {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } finally {
      lazy.clearTimeout(timeout);
    }
  }

  async #check() {
    if (this.#state.status == Status.DOWNLOADING) {
      return this.state;
    }
    const previous = this.#state;
    this.#set({ status: Status.CHECKING });
    try {
      const json = await this.#fetchManifest();
      Services.prefs.setIntPref(PREF_LAST_CHECK, Math.floor(Date.now() / 1000));
      if (!isNewerVersion(this.currentVersion, json?.latest)) {
        await this.#discardStaged();
        this.#set({ status: Status.UP_TO_DATE, version: null, url: null });
        return this.state;
      }
      const release = pickRelease(json, AppConstants.platform);
      if (!release) {
        // Newer version, but nothing published for this platform yet.
        this.#set({ status: Status.UP_TO_DATE, version: null, url: null });
        return this.state;
      }
      if (
        previous.status == Status.READY &&
        previous.version == release.version
      ) {
        this.#set({ ...previous });
        return this.state;
      }
      await this.#discardStaged();
      await this.#prepare(release);
    } catch (error) {
      console.error("Peppermint update check failed", error);
      this.#set({
        status: Status.FAILED,
        error: String(error?.message ?? error),
      });
    }
    return this.state;
  }

  // True when this install may replace itself.
  #canSelfInstall(release) {
    const wanted = INSTALLABLE_EXTENSION[AppConstants.platform];
    if (!wanted || fileExtensionOf(release.url) != wanted) {
      return false;
    }
    if (
      !AppConstants.MOZILLA_OFFICIAL &&
      !Services.prefs.getBoolPref(PREF_ALLOW_DEV_INSTALL, false)
    ) {
      // A development build must never overwrite itself.
      return false;
    }
    const target = this.#installTarget();
    return !!target?.parent?.isWritable() && target.isWritable();
  }

  /** The thing that gets replaced: the .app bundle or the install folder. */
  #installTarget() {
    try {
      const exe = Services.dirsvc.get("XREExeF", Ci.nsIFile);
      switch (AppConstants.platform) {
        case "macosx":
          // .../Peppermint.app/Contents/MacOS/peppermint
          return exe.parent.parent.parent;
        default:
          return exe.parent;
      }
    } catch (e) {
      return null;
    }
  }

  async #prepare(release) {
    const autoDownload = Services.prefs.getBoolPref(PREF_AUTO_DOWNLOAD, true);
    if (!autoDownload || !this.#canSelfInstall(release)) {
      this.#set({
        status: Status.MANUAL,
        version: release.version,
        url: release.url,
        progress: 0,
        error: null,
      });
      return;
    }
    this.#set({
      status: Status.DOWNLOADING,
      version: release.version,
      url: release.url,
      progress: 0,
      error: null,
    });
    try {
      const staged = await this.#downloadAndStage(release);
      Services.prefs.setStringPref(PREF_STAGED_VERSION, release.version);
      Services.prefs.setStringPref(PREF_STAGED_PATH, staged);
      this.#set({ status: Status.READY, progress: 1 });
    } catch (error) {
      console.error("Peppermint update download failed", error);
      await this.#discardStaged();
      // The user can still get the file by hand.
      this.#set({
        status: Status.MANUAL,
        version: release.version,
        url: release.url,
        error: String(error?.message ?? error),
      });
    }
  }

  #updateDir(version) {
    return PathUtils.join(PathUtils.profileDir, UPDATE_DIR_NAME, version);
  }

  async #downloadAndStage(release) {
    const dir = this.#updateDir(release.version);
    await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
    await IOUtils.makeDirectory(dir, { createAncestors: true });
    const fileName = decodeURIComponent(
      new URL(release.url).pathname.split("/").pop() || "update"
    ).replace(/[^\w.\-]/g, "_");
    const target = PathUtils.join(dir, fileName);

    this.#download = await lazy.Downloads.createDownload({
      source: { url: release.url, isPrivate: true },
      target,
    });
    this.#download.onchange = () => {
      const { currentBytes, totalBytes } = this.#download;
      if (totalBytes > 0 && this.#state.status == Status.DOWNLOADING) {
        this.#state = { ...this.#state, progress: currentBytes / totalBytes };
        Services.obs.notifyObservers(
          null,
          UPDATE_STATE_TOPIC,
          Status.DOWNLOADING
        );
      }
    };
    try {
      await this.#download.start();
    } finally {
      this.#download = null;
    }

    if (release.sha256) {
      const actual = await IOUtils.computeHexDigest(target, "sha256");
      if (actual.toLowerCase() != release.sha256) {
        throw new Error("The downloaded file does not match its checksum");
      }
    }

    switch (AppConstants.platform) {
      case "macosx":
        return await this.#stageMac(target, dir, release);
      case "linux":
        return await this.#stageLinux(target, release);
      default:
        // The Windows installer is run as downloaded.
        return target;
    }
  }

  async #assertStagedVersion(iniPath, release) {
    const version = await readIniVersion(iniPath);
    if (!version || Services.vc.compare(version, release.version) !== 0) {
      throw new Error(
        `The update contains version ${version}, expected ${release.version}`
      );
    }
  }

  // Copies the .app out of the dmg, next to the installed app.
  async #stageMac(dmg, dir, release) {
    const target = this.#installTarget();
    const mount = PathUtils.join(dir, "mount");
    await IOUtils.makeDirectory(mount);
    const staged = PathUtils.join(
      target.parent.path,
      `.peppermint-update-${release.version}.app`
    );
    await IOUtils.remove(staged, { recursive: true, ignoreAbsent: true });
    // Recorded early so a failed attempt is cleaned up by #discardStaged.
    Services.prefs.setStringPref(PREF_STAGED_PATH, staged);
    await run("/usr/bin/hdiutil", [
      "attach",
      "-nobrowse",
      "-readonly",
      "-noautoopen",
      "-mountpoint",
      mount,
      dmg,
    ]);
    try {
      const apps = (await IOUtils.getChildren(mount)).filter(path =>
        path.endsWith(".app")
      );
      if (apps.length != 1) {
        throw new Error("The disk image does not contain exactly one app");
      }
      await run("/usr/bin/ditto", [apps[0], staged]);
    } finally {
      await run("/usr/bin/hdiutil", ["detach", "-force", mount]).catch(
        () => {}
      );
    }
    await run("/usr/bin/xattr", ["-dr", "com.apple.quarantine", staged]).catch(
      () => {}
    );
    await this.#assertStagedVersion(
      PathUtils.join(staged, "Contents", "Resources", "application.ini"),
      release
    );
    return staged;
  }

  // Unpacks the tarball next to the install folder.
  async #stageLinux(tarball, release) {
    const target = this.#installTarget();
    const staged = PathUtils.join(
      target.parent.path,
      `.peppermint-update-${release.version}`
    );
    await IOUtils.remove(staged, { recursive: true, ignoreAbsent: true });
    Services.prefs.setStringPref(PREF_STAGED_PATH, staged);
    await IOUtils.makeDirectory(staged);
    await run("tar", ["-xJf", tarball, "-C", staged, "--strip-components=1"]);
    await this.#assertStagedVersion(
      PathUtils.join(staged, "application.ini"),
      release
    );
    if (
      !(await IOUtils.exists(PathUtils.join(staged, AppConstants.MOZ_APP_NAME)))
    ) {
      throw new Error("The update does not contain the application binary");
    }
    return staged;
  }

  async #discardStaged() {
    this.#download?.cancel().catch(() => {});
    const path = Services.prefs.getStringPref(PREF_STAGED_PATH, "");
    Services.prefs.clearUserPref(PREF_STAGED_VERSION);
    Services.prefs.clearUserPref(PREF_STAGED_PATH);
    if (path) {
      await IOUtils.remove(path, { recursive: true, ignoreAbsent: true }).catch(
        () => {}
      );
    }
    await IOUtils.remove(
      PathUtils.join(PathUtils.profileDir, UPDATE_DIR_NAME),
      {
        recursive: true,
        ignoreAbsent: true,
      }
    ).catch(() => {});
  }

  /** Whether "Restart to update" can be offered. */
  get readyToInstall() {
    return this.#state.status == Status.READY;
  }

  /**
   * Quits and lets a detached helper replace the app, then start it again.
   * Falls back to the download page when anything is missing.
   */
  async applyAndRestart() {
    const staged = Services.prefs.getStringPref(PREF_STAGED_PATH, "");
    const target = this.#installTarget();
    if (!this.readyToInstall || !staged || !target) {
      return false;
    }
    try {
      const helperDir = PathUtils.join(PathUtils.profileDir, UPDATE_DIR_NAME);
      await IOUtils.makeDirectory(helperDir, { createAncestors: true });
      const pid = String(Services.appinfo.processID);
      if (AppConstants.platform == "win") {
        const script = PathUtils.join(helperDir, "apply.cmd");
        await IOUtils.writeUTF8(
          script,
          [
            "@echo off",
            ":wait",
            'tasklist /FI "PID eq %~1" 2>NUL | find "%~1" >NUL',
            "if not errorlevel 1 (timeout /t 1 /nobreak >NUL & goto wait)",
            '"%~2" /S "/InstallDirectoryPath=%~3"',
            'start "" "%~4"',
            "",
          ].join("\r\n")
        );
        const exe = Services.dirsvc.get("XREExeF", Ci.nsIFile).path;
        spawnDetached(
          `${Services.dirsvc.get("SysD", Ci.nsIFile).path}\\cmd.exe`,
          ["/c", script, pid, staged, target.path, exe]
        );
      } else {
        const mac = AppConstants.platform == "macosx";
        const script = PathUtils.join(helperDir, "apply.sh");
        const launch = mac
          ? 'open "$TARGET"'
          : `"$TARGET/${AppConstants.MOZ_APP_NAME}" >/dev/null 2>&1 &`;
        await IOUtils.writeUTF8(
          script,
          [
            "#!/bin/sh",
            "trap '' HUP",
            'PID="$1"; STAGED="$2"; TARGET="$3"',
            'BACKUP="$TARGET.old-update"',
            'while kill -0 "$PID" 2>/dev/null; do sleep 0.3; done',
            'rm -rf "$BACKUP"',
            'if mv "$TARGET" "$BACKUP"; then',
            '  if mv "$STAGED" "$TARGET"; then rm -rf "$BACKUP"; else mv "$BACKUP" "$TARGET"; fi',
            "fi",
            launch,
            "",
          ].join("\n"),
          { mode: 0o755 }
        );
        spawnDetached("/bin/sh", [script, pid, staged, target.path]);
      }
    } catch (error) {
      console.error("Peppermint update could not be started", error);
      this.#set({
        status: Status.FAILED,
        error: String(error?.message ?? error),
      });
      return false;
    }
    Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
    return true;
  }

  /** Clears leftovers of an update that is already installed. */
  async cleanupInstalled() {
    const staged = Services.prefs.getStringPref(PREF_STAGED_VERSION, "");
    if (staged && !isNewerVersion(this.currentVersion, staged)) {
      await this.#discardStaged();
      return;
    }
    // Restore a prepared update after a restart without downloading again.
    const path = Services.prefs.getStringPref(PREF_STAGED_PATH, "");
    if (staged && path && (await IOUtils.exists(path))) {
      this.#state = {
        status: Status.READY,
        version: staged,
        url: null,
        progress: 1,
      };
    }
  }
}

export const PeppermintUpdater = new Updater();
