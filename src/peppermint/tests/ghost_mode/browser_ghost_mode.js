/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { PeppermintGhostMode } = ChromeUtils.importESModule(
  "moz-src:///peppermint/ghost-mode/PeppermintGhostMode.sys.mjs",
);
const { ZenGhostModeWidget } = ChromeUtils.importESModule(
  "moz-src:///peppermint/ghost-mode/ZenGhostModeWidget.sys.mjs",
);
const { Downloads } = ChromeUtils.importESModule(
  "resource://gre/modules/Downloads.sys.mjs",
);
const { PrivateBrowsingUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
);
const { notesDirectory } = ChromeUtils.importESModule(
  "resource:///modules/zen/notepad/ZenNotepadStore.sys.mjs",
);

const PREF_DELETE = "zen.ghost-mode.delete-downloads";
const PREF_NOTICE = "zen.ghost-mode.notice-shown";

registerCleanupFunction(() => {
  Services.prefs.clearUserPref(PREF_DELETE);
  Services.prefs.clearUserPref(PREF_NOTICE);
});

function ghostButton(win = window) {
  return win.document.getElementById("zen-ghost-mode-button");
}

async function openGhostWindow() {
  const opened = BrowserTestUtils.waitForNewWindow();
  ZenGhostModeWidget.onCommand({ view: window });
  const win = await opened;
  await TestUtils.waitForCondition(
    () => win.gBrowserInit.delayedStartupFinished,
    "ghost window finished starting",
  );
  return win;
}

async function privateDownload(contents) {
  const source = await IOUtils.createUniqueFile(
    PathUtils.tempDir,
    "ghost-source.txt",
  );
  await IOUtils.writeUTF8(source, contents);
  const target = await IOUtils.createUniqueFile(
    PathUtils.tempDir,
    "ghost-target.txt",
  );
  const download = await Downloads.createDownload({
    source: { url: PathUtils.toFileURI(source), isPrivate: true },
    target,
  });
  const list = await Downloads.getList(Downloads.PRIVATE);
  await list.add(download);
  await download.start();
  await IOUtils.remove(source);
  return { download, list, target };
}

add_task(async function test_ghost_defaults() {
  Assert.ok(
    Services.prefs.getBoolPref("privacy.query_stripping.enabled.pbmode"),
    "tracking parameters are stripped in Ghost windows",
  );
  Assert.ok(
    !Services.prefs.getBoolPref("browser.search.suggest.enabled.private"),
    "search suggestions are off in Ghost windows",
  );
  Assert.ok(
    !Services.prefs.getBoolPref(PREF_DELETE),
    "downloads are kept unless the user asks otherwise",
  );
  Assert.ok(
    Services.prefs.getBoolPref("privacy.fingerprintingProtection.pbmode"),
    "fingerprinting protection is on in Ghost windows",
  );
});

add_task(async function test_button_opens_ghost_window_and_shows_state() {
  const button = ghostButton();
  Assert.ok(button, "the Ghost Mode button exists");
  Assert.ok(!button.hasAttribute("ghost-open"), "no ghost window yet");

  const win = await openGhostWindow();
  Assert.ok(PrivateBrowsingUtils.isWindowPrivate(win), "the window is private");
  await TestUtils.waitForCondition(
    () => button.hasAttribute("ghost-open"),
    "the button shows that a ghost window is open",
  );
  Assert.ok(
    !ghostButton(win)?.hasAttribute("ghost-open"),
    "the button inside the ghost window stays plain",
  );

  await BrowserTestUtils.closeWindow(win);
  await TestUtils.waitForCondition(
    () => !button.hasAttribute("ghost-open"),
    "the state clears when the ghost window closes",
  );
});

add_task(async function test_notice_is_shown_once() {
  Services.prefs.setBoolPref(PREF_NOTICE, false);
  const win = await openGhostWindow();
  await TestUtils.waitForCondition(
    () =>
      [
        ...win.document.querySelectorAll("#zen-toast-container .zen-toast"),
      ].some(
        (toast) =>
          toast.querySelector("label")?.getAttribute("data-l10n-id") ===
          "zen-ghost-mode-notice-toast",
      ),
    "the notice toast is shown",
  );
  Assert.ok(
    Services.prefs.getBoolPref(PREF_NOTICE),
    "the notice is remembered",
  );
  await BrowserTestUtils.closeWindow(win);

  const second = await openGhostWindow();
  await new Promise((resolve) => setTimeout(resolve, 1000)); // eslint-disable-line mozilla/no-arbitrary-setTimeout
  Assert.equal(
    second.document.querySelectorAll("#zen-toast-container .zen-toast").length,
    0,
    "the notice does not come back",
  );
  await BrowserTestUtils.closeWindow(second);
});

add_task(async function test_downloads_are_deleted_only_when_asked() {
  Services.prefs.setBoolPref(PREF_DELETE, false);
  const kept = await privateDownload("keep me");
  await TestUtils.waitForCondition(
    () => PeppermintGhostMode.trackedDownloadCount > 0,
    "the finished download is tracked",
  );
  Assert.equal(await PeppermintGhostMode.deleteDownloads(), 0, "setting off");
  Assert.ok(await IOUtils.exists(kept.target), "the file is kept");
  Assert.equal(
    PeppermintGhostMode.trackedDownloadCount,
    0,
    "the list is forgotten either way",
  );
  await IOUtils.remove(kept.target);
  await kept.list.remove(kept.download);

  Services.prefs.setBoolPref(PREF_DELETE, true);
  const removed = await privateDownload("delete me");
  const changed = await privateDownload("replace me");
  await TestUtils.waitForCondition(
    () => PeppermintGhostMode.trackedDownloadCount === 2,
    "both downloads are tracked",
  );
  await IOUtils.writeUTF8(changed.target, "the user edited this file");

  Assert.equal(
    await PeppermintGhostMode.deleteDownloads(),
    1,
    "one file removed",
  );
  Assert.ok(!(await IOUtils.exists(removed.target)), "the download is deleted");
  Assert.ok(
    await IOUtils.exists(changed.target),
    "a file that changed afterwards is kept",
  );
  await IOUtils.remove(changed.target);
  await removed.list.remove(removed.download);
  await changed.list.remove(changed.download);
});

add_task(async function test_last_ghost_window_close_deletes_downloads() {
  Services.prefs.setBoolPref(PREF_DELETE, true);
  const win = await openGhostWindow();
  const file = await privateDownload("gone with the window");
  await TestUtils.waitForCondition(
    () => PeppermintGhostMode.trackedDownloadCount > 0,
    "the download is tracked",
  );
  await BrowserTestUtils.closeWindow(win);
  await TestUtils.waitForCondition(
    async () => !(await IOUtils.exists(file.target)),
    "the file is deleted when the last ghost window closes",
  );
  await file.list.remove(file.download);
});

add_task(async function test_notepad_does_not_save_in_ghost_window() {
  const before = (await IOUtils.exists(notesDirectory()))
    ? (await IOUtils.getChildren(notesDirectory())).length
    : 0;

  const win = await openGhostWindow();
  const tab = await BrowserTestUtils.openNewForegroundTab(
    win.gBrowser,
    "about:blank",
  );
  const loaded = BrowserTestUtils.browserLoaded(
    tab.linkedBrowser,
    false,
    (next) => next.startsWith("mint:"),
  );
  BrowserTestUtils.startLoadingURIString(tab.linkedBrowser, "mint://note");
  await loaded;
  await SpecialPowers.spawn(tab.linkedBrowser, [], async () => {
    await ContentTaskUtils.waitForCondition(
      () => content.document.documentElement.dataset.mintNotepad === "ready",
      "the notepad is ready",
    );
    const editor = content.document.getElementById("mint-note-editor");
    editor.focus();
    editor.querySelector(".mint-line").textContent = "a secret thought";
    content.document.getElementById("mint-note-save").click();
    await ContentTaskUtils.waitForCondition(
      () =>
        content.document.getElementById("mint-note-status").dataset.state ===
        "private",
      "the notepad says the note is not saved",
    );
  });

  const after = (await IOUtils.exists(notesDirectory()))
    ? (await IOUtils.getChildren(notesDirectory())).length
    : 0;
  Assert.equal(after, before, "nothing was written to the profile");
  await BrowserTestUtils.closeWindow(win);
});
