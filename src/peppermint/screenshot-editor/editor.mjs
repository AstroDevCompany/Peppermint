/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The screenshot editor: draws the capture on a canvas with the shapes the
 * user adds on top, and copies or saves the flattened result. Redaction is
 * burned into the pixels of the exported image, so nothing under a redacted
 * box can be recovered from it.
 */

const { takeSession } = ChromeUtils.importESModule(
  "moz-src:///peppermint/screenshot-editor/PeppermintScreenshotEditor.sys.mjs"
);
const { ScreenshotsUtils } = ChromeUtils.importESModule(
  "moz-src:///browser/components/screenshots/ScreenshotsUtils.sys.mjs"
);
const { AppConstants } = ChromeUtils.importESModule(
  "resource://gre/modules/AppConstants.sys.mjs"
);

const browser = window.arguments[0];
const session = takeSession(
  new URLSearchParams(location.search).get("session")
);

const canvas = document.getElementById("shot-canvas");
const context = canvas.getContext("2d");
const wrap = document.getElementById("shot-wrap");
const textInput = document.getElementById("shot-text");
const toolButtons = document.querySelectorAll("[data-tool]");
const swatches = document.querySelectorAll("[data-color]");
const undoButton = document.getElementById("shot-undo");
const redoButton = document.getElementById("shot-redo");
const actionButtons = [
  document.getElementById("shot-copy"),
  document.getElementById("shot-save"),
  document.getElementById("shot-both"),
];

const REDACT_COLOR = "#000000";
// Strokes and text grow with the capture, so they look the same on a small
// region and on a full page.
const UNIT_DIVISOR = 500;
const MIN_UNIT = 2;
const MIN_SHAPE_UNITS = 1.5;

let bitmap = null;
let unit = MIN_UNIT;
let tool = "arrow";
let color = "#e5484d";
let shapes = [];
let undone = [];
let draft = null;
let pendingText = null;

function closeEditor() {
  window.close();
}

function lineWidth() {
  return unit * 1.5;
}

function drawArrow({ x1, y1, x2, y2 }) {
  const head = lineWidth() * 4;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
  context.beginPath();
  context.moveTo(x2, y2);
  for (const side of [-1, 1]) {
    context.lineTo(
      x2 - head * Math.cos(angle + (side * Math.PI) / 7),
      y2 - head * Math.sin(angle + (side * Math.PI) / 7)
    );
    context.moveTo(x2, y2);
  }
  context.stroke();
}

function drawShape(shape) {
  context.lineWidth = lineWidth();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = shape.color;
  context.fillStyle = shape.color;
  switch (shape.type) {
    case "arrow":
      drawArrow(shape);
      break;
    case "rect":
      context.strokeRect(
        Math.min(shape.x1, shape.x2),
        Math.min(shape.y1, shape.y2),
        Math.abs(shape.x2 - shape.x1),
        Math.abs(shape.y2 - shape.y1)
      );
      break;
    case "redact":
      context.fillRect(
        Math.min(shape.x1, shape.x2),
        Math.min(shape.y1, shape.y2),
        Math.abs(shape.x2 - shape.x1),
        Math.abs(shape.y2 - shape.y1)
      );
      break;
    case "pen":
      context.beginPath();
      shape.points.forEach(([x, y], index) =>
        index ? context.lineTo(x, y) : context.moveTo(x, y)
      );
      if (shape.points.length == 1) {
        context.lineTo(shape.points[0][0] + 0.01, shape.points[0][1]);
      }
      context.stroke();
      break;
    case "text":
      context.font = `600 ${unit * 8}px system-ui, sans-serif`;
      context.textBaseline = "top";
      context.lineWidth = unit * 1.2;
      context.strokeStyle = shape.color == "#ffffff" ? "#111111" : "#ffffff";
      context.strokeText(shape.text, shape.x1, shape.y1);
      context.fillText(shape.text, shape.x1, shape.y1);
      break;
  }
}

function render() {
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0);
  for (const shape of shapes) {
    drawShape(shape);
  }
  if (draft) {
    drawShape(draft);
  }
  undoButton.disabled = !shapes.length;
  redoButton.disabled = !undone.length;
}

function addShape(shape) {
  shapes.push(shape);
  undone = [];
  render();
}

function undo() {
  if (shapes.length) {
    undone.push(shapes.pop());
    render();
  }
}

function redo() {
  if (undone.length) {
    shapes.push(undone.pop());
    render();
  }
}

function pointFor(event) {
  const box = canvas.getBoundingClientRect();
  return [
    ((event.clientX - box.left) / box.width) * canvas.width,
    ((event.clientY - box.top) / box.height) * canvas.height,
  ];
}

function startText([x, y], event) {
  const box = canvas.getBoundingClientRect();
  const scale = box.width / canvas.width;
  const wrapBox = wrap.getBoundingClientRect();
  pendingText = { x, y };
  textInput.hidden = false;
  textInput.value = "";
  textInput.style.left = `${event.clientX - wrapBox.left}px`;
  textInput.style.top = `${event.clientY - wrapBox.top}px`;
  textInput.style.fontSize = `${unit * 8 * scale}px`;
  textInput.style.color = color;
  textInput.focus();
}

function commitText() {
  if (!pendingText) {
    return;
  }
  const { x, y } = pendingText;
  const text = textInput.value.trim();
  pendingText = null;
  textInput.hidden = true;
  if (text) {
    addShape({ type: "text", color, x1: x, y1: y, text });
  }
}

function cancelText() {
  pendingText = null;
  textInput.hidden = true;
}

canvas.addEventListener("pointerdown", event => {
  if (event.button != 0) {
    return;
  }
  commitText();
  const point = pointFor(event);
  if (tool == "text") {
    startText(point, event);
    event.preventDefault();
    return;
  }
  try {
    canvas.setPointerCapture(event.pointerId);
  } catch {
    // Only a pointer that is down can be captured.
  }
  const [x, y] = point;
  const shapeColor = tool == "redact" ? REDACT_COLOR : color;
  draft =
    tool == "pen"
      ? { type: "pen", color: shapeColor, points: [point] }
      : { type: tool, color: shapeColor, x1: x, y1: y, x2: x, y2: y };
  render();
});

canvas.addEventListener("pointermove", event => {
  if (!draft) {
    return;
  }
  const [x, y] = pointFor(event);
  if (draft.type == "pen") {
    draft.points.push([x, y]);
  } else {
    draft.x2 = x;
    draft.y2 = y;
  }
  render();
});

function finishDraft() {
  if (!draft) {
    return;
  }
  const finished = draft;
  draft = null;
  const size =
    finished.type == "pen"
      ? finished.points.length
      : Math.hypot(finished.x2 - finished.x1, finished.y2 - finished.y1);
  const minimum = finished.type == "pen" ? 1 : unit * MIN_SHAPE_UNITS;
  if (size >= minimum) {
    addShape(finished);
  } else {
    render();
  }
}

canvas.addEventListener("pointerup", finishDraft);
canvas.addEventListener("pointercancel", () => {
  draft = null;
  render();
});

textInput.addEventListener("keydown", event => {
  if (event.key == "Enter") {
    event.preventDefault();
    commitText();
  } else if (event.key == "Escape") {
    event.preventDefault();
    event.stopPropagation();
    cancelText();
  }
});
textInput.addEventListener("blur", commitText);

function selectTool(toolName) {
  tool = toolName;
  for (const button of toolButtons) {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.tool == toolName)
    );
  }
  canvas.dataset.tool = toolName;
  // Redaction is always black; the colors apply to everything else.
  document
    .getElementById("shot-colors")
    .toggleAttribute("inert", toolName == "redact");
}

function selectColor(value) {
  color = value;
  for (const swatch of swatches) {
    swatch.setAttribute("aria-pressed", String(swatch.dataset.color == value));
  }
}

for (const button of toolButtons) {
  button.addEventListener("click", () => selectTool(button.dataset.tool));
}
for (const swatch of swatches) {
  swatch.style.setProperty("--swatch", swatch.dataset.color);
  swatch.addEventListener("click", () => selectColor(swatch.dataset.color));
}
undoButton.addEventListener("click", undo);
redoButton.addEventListener("click", redo);

function exportBlob() {
  commitText();
  draft = null;
  render();
  return new Promise(resolve => canvas.toBlob(resolve, "image/png"));
}

function setBusy(busy) {
  for (const button of actionButtons) {
    button.disabled = busy;
  }
}

async function copyImage(blob) {
  try {
    await ScreenshotsUtils.copyScreenshot(blob, browser, "PreviewCopy");
  } catch (error) {
    // The copy happens before the part that can fail (telemetry).
    console.error("Screenshot editor: copy reported an error", error);
  }
}

async function saveImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    return await ScreenshotsUtils.downloadScreenshot(
      null,
      url,
      browser,
      "PreviewDownload"
    );
  } catch (error) {
    console.error("Screenshot editor: saving failed", error);
    return false;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function run(copy, save) {
  setBusy(true);
  const blob = await exportBlob();
  if (copy) {
    await copyImage(blob);
  }
  if (save && !(await saveImage(blob))) {
    setBusy(false);
    return;
  }
  closeEditor();
}

document
  .getElementById("shot-copy")
  .addEventListener("click", () => run(true, false));
document
  .getElementById("shot-save")
  .addEventListener("click", () => run(false, true));
document
  .getElementById("shot-both")
  .addEventListener("click", () => run(true, true));
document.getElementById("shot-cancel").addEventListener("click", () => {
  ScreenshotsUtils.recordTelemetryEvent("canceledPreviewCancel");
  closeEditor();
});

window.addEventListener(
  "keydown",
  event => {
    const accel =
      AppConstants.platform == "macosx" ? event.metaKey : event.ctrlKey;
    const key = event.key.toLowerCase();
    if (event.key == "Escape" && !pendingText) {
      event.preventDefault();
      closeEditor();
    } else if (accel && key == "z") {
      event.preventDefault();
      event.shiftKey ? redo() : undo();
    } else if (accel && key == "s") {
      event.preventDefault();
      run(false, true);
    } else if (accel && key == "c" && document.activeElement != textInput) {
      event.preventDefault();
      run(true, false);
    }
  },
  true
);

async function init() {
  if (!session) {
    closeEditor();
    return;
  }
  bitmap = await createImageBitmap(session.blob);
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  unit = Math.max(
    MIN_UNIT,
    Math.round(Math.max(bitmap.width, bitmap.height) / UNIT_DIVISOR)
  );
  selectTool(tool);
  selectColor(color);
  render();
}

init().catch(error => {
  console.error("The screenshot editor could not start", error);
  closeEditor();
});
