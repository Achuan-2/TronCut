import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { recordingControls } from "./recording-controls.mjs";

if (process.platform !== "win32")
  throw new Error("Windows recording border test");
const run = promisify(execFile);
// Compatible capture includes the user's system cursor. Inspect the frame's
// perimeter so a colored cursor inside the white fixture is not a border leak.
function greenBorderPixels(data, { width, height }) {
  let green = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= 12 && x < width - 12 && y >= 12 && y < height - 12) continue;
      const i = (y * width + x) * 3;
      if (
        data[i] < 170 &&
        data[i + 1] > 200 &&
        data[i + 2] > 120 &&
        data[i + 2] < 210
      )
        green++;
    }
  }
  return green;
}
const root = path.resolve("test-output/recording-border", `run-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: path.join(root, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["."], env });
let targetHandle = "0";
const inspect = async () =>
  JSON.parse(
    (
      await run(
        "powershell.exe",
        [
          "-NoProfile",
          "-File",
          path.resolve("scripts/inspect-recording-border.ps1"),
          "-TargetHandle",
          targetHandle,
        ],
        { windowsHide: true },
      )
    ).stdout.trim(),
  );
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  const source = await app.evaluate(async ({ BrowserWindow }) => {
    const target = new BrowserWindow({
      width: 480,
      height: 320,
      x: 80,
      y: 80,
      frame: false,
      backgroundColor: "#ffffff",
      title: "TronCut Border Test",
      skipTaskbar: true,
    });
    await target.loadURL(
      "data:text/html,<html style='background:white'><title>TronCut Border Test</title></html>",
    );
    return { id: target.id, sourceId: target.getMediaSourceId() };
  });
  targetHandle = source.sourceId.split(":")[1];
  expect((await inspect()).exists).toBe(false);
  await page.getByRole("button", { name: "录制", exact: true }).click();
  await page
    .locator(`.capture-sources > button[data-source-id="${source.sourceId}"]`)
    .click();
  await page.getByLabel("麦克风", { exact: true }).uncheck();
  await page.getByLabel("录制帧率", { exact: true }).selectOption("15");
  await page.getByRole("button", { name: "开始录制", exact: true }).click();
  const controls = await recordingControls(app);
  let border = await inspect();
  expect(border.visible).toBe(true);
  expect(border.bounds).toEqual(border.targetBounds);
  expect(border.affinity).toBe(0x11);
  expect(border.style & 0x080800a8).toBe(0x080800a8); // No activate, layered, tool, transparent, topmost.
  expect(border.foreground).not.toBe(border.handle);
  await app.evaluate(
    ({ BrowserWindow }, id) =>
      BrowserWindow.fromId(id).setBounds({
        x: 150,
        y: 120,
        width: 560,
        height: 360,
      }),
    source.id,
  );
  await expect
    .poll(async () => {
      border = await inspect();
      return (
        JSON.stringify(border.bounds) === JSON.stringify(border.targetBounds)
      );
    })
    .toBe(true);
  await app.evaluate(
    ({ BrowserWindow }, id) => BrowserWindow.fromId(id).minimize(),
    source.id,
  );
  await expect.poll(async () => (await inspect()).visible).toBe(false);
  await app.evaluate(
    ({ BrowserWindow }, id) => BrowserWindow.fromId(id).restore(),
    source.id,
  );
  await expect.poll(async () => (await inspect()).visible).toBe(true);
  const pause = controls.locator("#pause");
  await pause.click();
  await expect(controls.getByRole("status")).toHaveText("已暂停");
  expect((await inspect()).visible).toBe(true);
  await pause.click();
  await controls.getByRole("button", { name: "停止录制", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("录制完成", {
    timeout: 30000,
  });
  expect((await inspect()).exists).toBe(false);
  await expect
    .poll(async () =>
      (
        await page.evaluate(() => window.framecraft.readRecovery())
      )?.project.assets.some((a) => a.kind === "video"),
    )
    .toBe(true);
  const recording = await page.evaluate(async () =>
    (await window.framecraft.readRecovery()).project.assets.find(
      (a) => a.kind === "video",
    ),
  );
  const frame = path.join(root, "recorded.png");
  await run(
    path.resolve("resources/bin/ffmpeg.exe"),
    ["-y", "-ss", "0.5", "-i", recording.path, "-frames:v", "1", frame],
    { windowsHide: true },
  );
  const { data, info } = await sharp(frame)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const green = greenBorderPixels(data, info);
  expect(green).toBe(0);
  // Cover the selected display with our white fixture so screen-capture checks
  // neither record unrelated desktop content nor confuse green UI with the border.
  const display = await app.evaluate(
    async ({ BrowserWindow, desktopCapturer, screen }, id) => {
      const target = BrowserWindow.fromId(id);
      const display = screen.getDisplayMatching(target.getBounds());
      target.setBounds(display.bounds);
      target.setFullScreen(true);
      target.setAlwaysOnTop(true, "screen-saver");
      target.showInactive();
      target.moveTop();
      BrowserWindow.getAllWindows()
        .find((w) => w.id !== id)
        .hide();
      const sources = await desktopCapturer.getSources({ types: ["screen"] });
      return {
        id: sources.find((s) => s.display_id === String(display.id)).id,
        bounds: screen.dipToScreenRect(null, display.bounds),
      };
    },
    source.id,
  );
  await page.waitForTimeout(700);
  await page.evaluate(async (id) => {
    await window.framecraft.selectCapture(id, false);
    await window.framecraft.nativeRecordingStart(id, 15, false);
  }, display.id);
  // Place the real controller over the white fixture and inspect the saved
  // pixels beneath it in both engines, rather than trusting the affinity flag.
  await page.evaluate(() =>
    window.framecraft.updateRecordingControls({
      phase: "recording",
      elapsed: 1,
      error: "",
    }),
  );
  const screenControls = await recordingControls(app);
  const controlsBounds = await app.evaluate(({ BrowserWindow, screen }) => {
    const controls = BrowserWindow.getAllWindows().find(
      (w) => w.getTitle() === "TronCut 录制控制",
    );
    const display = screen.getDisplayMatching(controls.getBounds());
    controls.setPosition(display.bounds.x + 40, display.bounds.y + 40);
    controls.setAlwaysOnTop(true, "screen-saver");
    controls.moveTop();
    return screen.dipToScreenRect(controls, controls.getBounds());
  });
  await screenControls.screenshot({
    path: path.join(root, "screen-controls.png"),
  });
  let displayBorder = await inspect();
  expect(displayBorder.bounds).toEqual({
    left: display.bounds.x,
    top: display.bounds.y,
    right: display.bounds.x + display.bounds.width,
    bottom: display.bounds.y + display.bounds.height,
  });
  await page.waitForTimeout(1200);
  const screenRecording = await page.evaluate(() =>
    window.framecraft.nativeRecordingStop(),
  );
  expect((await inspect()).exists).toBe(false);
  const verifyWhiteCapture = async (file, name) => {
    const image = path.join(root, name);
    await run(
      path.resolve("resources/bin/ffmpeg.exe"),
      ["-y", "-ss", "0.5", "-i", file, "-frames:v", "1", image],
      { windowsHide: true },
    );
    const { data, info } = await sharp(image)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const green = greenBorderPixels(data, info);
    expect(green).toBe(0);
    let white = 0,
      samples = 0;
    for (let y = 15; y < controlsBounds.height - 15; y += 8) {
      for (let x = 15; x < controlsBounds.width - 15; x += 8) {
        const i =
          ((controlsBounds.y - display.bounds.y + y) * info.width +
            controlsBounds.x -
            display.bounds.x +
            x) *
          3;
        if (Math.min(...data.subarray(i, i + 3)) > 235) white++;
        samples++;
      }
    }
    expect(white / samples).toBeGreaterThan(0.98);
    // Check every side: exclusion must reveal the fixture, not a black frame.
    for (const [x, y] of [
      [20, 0],
      [20, info.height - 1],
      [0, 20],
      [info.width - 1, 20],
    ]) {
      const i = (y * info.width + x) * 3;
      expect(Math.min(...data.subarray(i, i + 3))).toBeGreaterThan(235);
    }
  };
  await verifyWhiteCapture(screenRecording.path, "native-screen.png");
  await app.evaluate(({ BrowserWindow }, id) => {
    const target = BrowserWindow.fromId(id);
    target.restore();
    target.showInactive();
    target.setAlwaysOnTop(true, "screen-saver");
    target.moveTop();
    const controls = BrowserWindow.getAllWindows().find(
      (w) => w.getTitle() === "TronCut 录制控制",
    );
    controls.moveTop();
  }, source.id);
  await page.evaluate(async () => {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });
    const id = await window.framecraft.recordingStart("screen");
    const recorder = new MediaRecorder(stream, {
      mimeType: "video/webm;codecs=vp8",
    });
    const capture = { id, stream, recorder, queue: Promise.resolve() };
    window.borderTestCapture = capture;
    recorder.ondataavailable = (event) => {
      capture.queue = capture.queue.then(async () =>
        window.framecraft.recordingChunk(
          id,
          new Uint8Array(await event.data.arrayBuffer()),
        ),
      );
    };
    recorder.start(200);
  });
  expect((await inspect()).visible).toBe(true);
  await page.waitForTimeout(1500);
  const compatible = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const capture = window.borderTestCapture;
        capture.recorder.onstop = async () => {
          try {
            await capture.queue;
            resolve(await window.framecraft.recordingStop(capture.id, 4));
          } catch (error) {
            reject(error);
          } finally {
            capture.stream.getTracks().forEach((track) => track.stop());
          }
        };
        capture.recorder.stop();
      }),
  );
  expect((await inspect()).exists).toBe(false);
  await verifyWhiteCapture(compatible.path, "compatible-screen.png");
  await page.evaluate(() => window.framecraft.updateRecordingControls(null));
  await expect.poll(() => screenControls.isClosed()).toBe(true);
  // A capture startup error must clear the already-visible border as well.
  await app.evaluate(() => {
    process.env["FRAMECRAFT_WGC-CAPTURE"] = "Z:/troncut-test-missing.exe";
  });
  await expect(
    page.evaluate(
      (id) => window.framecraft.nativeRecordingStart(id, 15, false),
      display.id,
    ),
  ).rejects.toThrow();
  expect((await inspect()).exists).toBe(false);
  await app.evaluate(() => {
    delete process.env["FRAMECRAFT_WGC-CAPTURE"];
  });
  expect(errors).toEqual([]);
  await fs.writeFile(
    path.join(root, "result.json"),
    JSON.stringify(
      {
        border,
        displayBorder,
        recordedGreenPixels: green,
        nativeScreen: screenRecording.path,
        compatibleScreen: compatible.path,
        rendererErrors: errors,
      },
      null,
      2,
    ),
  );
  await app.evaluate(
    ({ BrowserWindow }, id) => BrowserWindow.fromId(id).destroy(),
    source.id,
  );
  console.log(
    `录制边框、窗口跟随、最小化、暂停、停止与失败清理、原生及兼容屏幕录制排除边框和控制窗通过：${root}`,
  );
} finally {
  await app.close();
}
