import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { recordingControls } from "./recording-controls.mjs";

const root = path.resolve(
  "test-output/recording-startup-ui",
  `run-${Date.now()}`,
);
await fs.mkdir(root, { recursive: true });
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: path.join(root, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.env.FRAMECRAFT_PACKAGED_SMOKE === "1";
const app = await electron.launch({
  ...(packaged
    ? {
        executablePath: path.resolve(
          process.env.FRAMECRAFT_PACKAGED_APP ??
            "release/win-unpacked/TronCut.exe",
        ),
      }
    : {}),
  args: packaged ? [] : ["."],
  env,
});
try {
  const page = await app.firstWindow();
  const fixture = await app.evaluate(async ({ BrowserWindow }) => {
    const target = new BrowserWindow({ width: 640, height: 480, backgroundColor: "#ff00ff" });
    await target.loadURL("data:text/html,<title>Recording startup fixture</title><body style='margin:0;background:%23ff00ff'></body>");
    globalThis.startupFixture = target;
    // Trace the real native protocol, rather than a delayed IPC stand-in.
    const childProcess = process.getBuiltinModule("child_process");
    const spawn = childProcess.spawn;
    globalThis.nativeHelpers = [];
    globalThis.recordingStartupTiming = {};
    const show = BrowserWindow.prototype.show;
    BrowserWindow.prototype.show = function (...args) {
      if (this.getTitle() === "TronCut 录制控制") globalThis.recordingStartupTiming.controlsShown = performance.now();
      return show.apply(this, args);
    };
    childProcess.spawn = function (...args) {
      const child = spawn.apply(this, args);
      if (String(args[0]).includes("wgc-capture")) {
        globalThis.nativeHelpers.push(child);
        let pending = "";
        child.stdout.on("data", (chunk) => {
          pending += chunk;
          const lines = pending.split(/\r?\n/);
          pending = lines.pop() ?? "";
          for (const line of lines) {
            if (line.includes('"recording-prepared"')) globalThis.recordingStartupTiming.prepared = performance.now();
            if (line.includes('"recording-started"')) globalThis.recordingStartupTiming.engineReady = performance.now();
          }
        });
      }
      return child;
    };
    return target.getMediaSourceId();
  });
  await app.evaluate(({ desktopCapturer }) => {
    const getSources = desktopCapturer.getSources.bind(desktopCapturer);
    globalThis.captureQueries = [];
    desktopCapturer.getSources = async (options) => {
      const started = performance.now();
      const sources = await getSources(options);
      globalThis.captureQueries.push({
        options,
        ms: performance.now() - started,
      });
      return sources;
    };
  });
  await page.getByRole("button", { name: "新建录制", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "开始录制", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByLabel("原生录制与可编辑鼠标", { exact: true }),
  ).toBeChecked();
  await page.locator(`.capture-sources > button[data-source-id="${fixture}"]`).click();
  await page.getByLabel("录制帧率", { exact: true }).selectOption("30");
  for (const microphone of [false, true]) {
    await page.getByLabel("麦克风", { exact: true }).setChecked(microphone);
    await app.evaluate(() => {
      globalThis.captureQueries = [];
      globalThis.recordingStartupTiming = {};
    });
    const opened = app.waitForEvent("window");
    const started = performance.now();
    await page.getByRole("button", { name: "开始录制", exact: true }).click();
    const overlay = await opened;
    await expect(overlay.locator("strong")).toHaveText("3");
    const visibleMs = performance.now() - started;
    const queries = await app.evaluate(() => globalThis.captureQueries);
    // Only the target's zero-thumbnail validation may run while counting down.
    expect(queries.length).toBeLessThanOrEqual(1);
    for (const query of queries) expect(query.options.thumbnailSize).toEqual({ width: 0, height: 0 });
    if (microphone) {
      await expect.poll(() => app.evaluate(() => !!globalThis.recordingStartupTiming.prepared)).toBe(true);
      expect(await app.evaluate(() => globalThis.recordingStartupTiming.engineReady)).toBeUndefined();
    }
    await page.evaluate(() => window.framecraft.cancelRecordingCountdown());
    await expect(
      page.getByRole("button", { name: "开始录制", exact: true }),
    ).toBeEnabled();
    expect(
      await app.evaluate(
        ({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().filter(
            (w) => w.getTitle() === "TronCut 录制控制",
          ).length,
      ),
    ).toBe(0);
    await expect.poll(() => app.evaluate(() => globalThis.nativeHelpers.every(
      (child) => child.exitCode !== null || child.signalCode !== null,
    ))).toBe(true);
    expect(await fs.readdir(path.join(root, "profile", "recordings")).catch(() => [])).toHaveLength(0);
    console.log(JSON.stringify({ microphone, visibleMs, queries }));
  }
  // Initialization must finish inside the countdown; the actual start remains
  // after it. A color change at the boundary detects any pre-countdown frames.
  await page.getByLabel("麦克风", { exact: true }).uncheck();
  await app.evaluate(() => { globalThis.recordingStartupTiming = {}; });
  const countdownOpened = app.waitForEvent("window");
  await page.getByRole("button", { name: "开始录制", exact: true }).click();
  const countdown = await countdownOpened;
  await expect(countdown.locator("strong")).toHaveText("3");
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) => {
        const controls = BrowserWindow.getAllWindows().find(
          (w) => w.getTitle() === "TronCut 录制控制",
        );
        return (
          !!controls &&
          controls.isVisible() &&
          !controls.webContents.isLoadingMainFrame()
        );
      }),
    )
    .toBe(true);
  await app.evaluate(({ BrowserWindow }) => {
    const overlay = BrowserWindow.getAllWindows().find((w) =>
      w.webContents
        .getURL()
        .includes(encodeURIComponent('aria-label="录制倒计时"')),
    );
    const controls = BrowserWindow.getAllWindows().find(
      (w) => w.getTitle() === "TronCut 录制控制",
    );
    overlay.once("closed", () => {
      globalThis.recordingStartupTiming.countdownClosed = performance.now();
      void globalThis.startupFixture.webContents.executeJavaScript("document.body.style.background = '#00ff00'");
    });
  });
  await expect
    .poll(
      () =>
        app.evaluate(() => {
          const timing = globalThis.recordingStartupTiming;
          return timing.controlsShown !== undefined &&
            timing.countdownClosed !== undefined
            ? timing.controlsShown - timing.countdownClosed
            : 10000;
        }),
      { timeout: 10000 },
    )
    .toBeLessThan(500);
  const controls = await recordingControls(app);
  const timing = await app.evaluate(() => globalThis.recordingStartupTiming);
  expect(timing.prepared).toBeLessThan(timing.countdownClosed);
  expect(timing.controlsShown).toBeLessThan(timing.countdownClosed);
  expect(timing.controlsShown).toBeLessThan(timing.engineReady);
  expect(timing.engineReady - timing.countdownClosed).toBeLessThan(1000);
  console.log(
    JSON.stringify({
      countdownToToolbarMs: timing.controlsShown - timing.countdownClosed,
      engineReadyAfterToolbarMs: timing.engineReady - timing.controlsShown,
      countdownToRecordingMs: timing.engineReady - timing.countdownClosed,
      preparedBeforeCountdownEndMs: timing.countdownClosed - timing.prepared,
    }),
  );
  await page.waitForTimeout(1000);
  const recordingWallSeconds = (await app.evaluate(() => performance.now()) - timing.engineReady) / 1000;
  await controls.getByRole("button", { name: "停止录制", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("录制完成", {
    timeout: 30000,
  });
  await expect.poll(async () => (await page.evaluate(() => window.framecraft.readRecovery()))?.project.assets.some((asset) => asset.kind === "video")).toBe(true);
  const asset = (await page.evaluate(() => window.framecraft.readRecovery())).project.assets.find((asset) => asset.kind === "video");
  const firstFrame = path.join(root, "first-frame.png");
  await promisify(execFile)(path.resolve("resources/bin/ffmpeg.exe"), ["-y", "-i", asset.path, "-frames:v", "1", firstFrame], { windowsHide: true });
  const { data, info } = await sharp(firstFrame).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const center = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
  expect(data[center]).toBeLessThan(80);
  expect(data[center + 1]).toBeGreaterThan(200);
  expect(data[center + 2]).toBeLessThan(80);
  expect(Math.abs(asset.duration - recordingWallSeconds)).toBeLessThan(0.8);
  expect(asset.cursor.samples.length).toBeGreaterThan(0);
  console.log(JSON.stringify({ duration: asset.duration, firstPixel: Array.from(data.subarray(center, center + 3)), cursorSamples: asset.cursor.samples.length }));
  await page.getByRole("button", { name: "录制", exact: true }).click();
  await page.getByLabel("麦克风", { exact: true }).check();
  await page.getByLabel("原生录制与可编辑鼠标", { exact: true }).uncheck();
  // A device that opens late must still be released if another request fails.
  await page.evaluate(() => {
    globalThis.deviceEvents = [];
    let cameraAttempts = 0;
    navigator.mediaDevices.getUserMedia = (constraints) => {
      const kind = constraints.video ? "camera" : "microphone";
      if (kind === "camera" && ++cameraAttempts === 1)
        return Promise.reject(new Error("startup fixture: preview unavailable"));
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 360;
      const stream = canvas.captureStream(30);
      // After startup fails, the settings preview may open a fresh stream.
      if (kind === "camera" && cameraAttempts > 2) return Promise.resolve(stream);
      globalThis.deviceEvents.push(`open:${kind}`);
      return new Promise((resolve, reject) => {
        setTimeout(
          () => {
            if (kind === "microphone") {
              globalThis.deviceEvents.push("failed:microphone");
              reject(new Error("startup fixture: microphone unavailable"));
            } else {
              globalThis.deviceEvents.push("ready:camera");
              const track = stream.getVideoTracks()[0], stop = track.stop.bind(track);
              globalThis.delayedCameraTrack = track;
              track.stop = () => { globalThis.deviceEvents.push("stop:camera"); stop(); };
              resolve(stream);
            }
          },
          kind === "microphone" ? 20 : 150,
        );
      });
    };
  });
  await page.getByLabel("摄像头", { exact: true }).check();
  await expect(page.locator(".recording-camera-settings .error-box")).toContainText("preview unavailable");
  await page.getByRole("button", { name: "开始录制", exact: true }).click();
  await expect(page.locator(".recorder-modal .error-box")).toContainText(
    "microphone unavailable",
  );
  expect(await page.evaluate(() => globalThis.deviceEvents)).toEqual([
    "open:microphone",
    "open:camera",
    "failed:microphone",
    "ready:camera",
    "stop:camera",
  ]);
  expect(await page.evaluate(() => globalThis.delayedCameraTrack.readyState)).toBe("ended");
  console.log("并行设备准备失败后，延迟打开的摄像头已释放");
} finally {
  await app.close();
}
