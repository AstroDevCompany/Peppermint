/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { openEditor, takeSession, WRAPPED_METHODS } = ChromeUtils.importESModule(
  "moz-src:///peppermint/screenshot-editor/PeppermintScreenshotEditor.sys.mjs"
);
const { ScreenshotsUtils } = ChromeUtils.importESModule(
  "moz-src:///browser/components/screenshots/ScreenshotsUtils.sys.mjs"
);

const WIDTH = 200;
const HEIGHT = 120;

async function whiteCapture() {
  const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, WIDTH, HEIGHT);
  return canvas.convertToBlob();
}

async function openTestEditor() {
  const { dialog, closedPromise } = await openEditor(
    gBrowser.selectedBrowser,
    await whiteCapture(),
    "Test page"
  );
  await dialog._dialogReady;
  const doc = dialog._frame.contentDocument;
  const canvas = doc.getElementById("shot-canvas");
  await TestUtils.waitForCondition(
    () => canvas.width === WIDTH,
    "the capture was drawn"
  );
  return {
    dialog,
    closedPromise,
    doc,
    canvas,
    win: dialog._frame.contentWindow,
  };
}

function pixel(canvas, x, y) {
  return Array.from(canvas.getContext("2d").getImageData(x, y, 1, 1).data);
}

function drag(canvas, win, from, to) {
  const box = canvas.getBoundingClientRect();
  const scale = box.width / canvas.width;
  const point = ([x, y]) => [x * scale, y * scale];
  const [x1, y1] = point(from);
  const [x2, y2] = point(to);
  EventUtils.synthesizeMouse(canvas, x1, y1, { type: "mousedown" }, win);
  EventUtils.synthesizeMouse(
    canvas,
    (x1 + x2) / 2,
    (y1 + y2) / 2,
    { type: "mousemove" },
    win
  );
  EventUtils.synthesizeMouse(canvas, x2, y2, { type: "mousemove" }, win);
  EventUtils.synthesizeMouse(canvas, x2, y2, { type: "mouseup" }, win);
}

add_task(function test_screenshots_hooks_exist() {
  for (const name of WRAPPED_METHODS) {
    Assert.equal(
      typeof ScreenshotsUtils[name],
      "function",
      `ScreenshotsUtils.${name} is still there to be wrapped`
    );
  }
  Assert.equal(
    takeSession("no-such-token"),
    null,
    "Unknown sessions are empty"
  );
});

add_task(async function test_editor_redacts_into_the_pixels() {
  await BrowserTestUtils.withNewTab("https://example.com/", async () => {
    const { doc, canvas, win, closedPromise } = await openTestEditor();
    Assert.equal(canvas.height, HEIGHT, "The capture keeps its size");
    Assert.deepEqual(
      pixel(canvas, 100, 60),
      [255, 255, 255, 255],
      "Starts as captured"
    );

    doc.querySelector('[data-tool="redact"]').click();
    drag(canvas, win, [40, 30], [160, 90]);
    Assert.deepEqual(
      pixel(canvas, 100, 60),
      [0, 0, 0, 255],
      "A redacted box is solid"
    );
    Assert.deepEqual(
      pixel(canvas, 10, 10),
      [255, 255, 255, 255],
      "The rest is untouched"
    );

    const undo = doc.getElementById("shot-undo");
    Assert.ok(!undo.disabled, "The box can be undone");
    undo.click();
    Assert.deepEqual(
      pixel(canvas, 100, 60),
      [255, 255, 255, 255],
      "Undo brings it back"
    );
    doc.getElementById("shot-redo").click();
    Assert.deepEqual(
      pixel(canvas, 100, 60),
      [0, 0, 0, 255],
      "Redo redacts again"
    );

    doc.querySelector('[data-tool="rect"]').click();
    doc.querySelector('[data-color="#e5484d"]').click();
    drag(canvas, win, [10, 10], [30, 30]);
    Assert.ok(!undo.disabled, "A second shape can be added");

    doc.getElementById("shot-cancel").click();
    await closedPromise;
  });
});

add_task(async function test_session_is_consumed_once() {
  await BrowserTestUtils.withNewTab("https://example.com/", async () => {
    const { win, doc, closedPromise } = await openTestEditor();
    const token = new URLSearchParams(win.location.search).get("session");
    Assert.equal(
      takeSession(token),
      null,
      "The editor already took its capture"
    );
    doc.getElementById("shot-cancel").click();
    await closedPromise;
  });
});
