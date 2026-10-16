import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
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
  for (const microphone of [false, true]) {
    await page.getByLabel("麦克风", { exact: true }).setChecked(microphone);
    await app.evaluate(() => {
      globalThis.captureQueries = [];
    });
    const opened = app.waitForEvent("window");
    const started = performance.now();
    await page.getByRole("button", { name: "开始录制", exact: true }).click();
    const overlay = await opened;
    await expect(overlay.locator("strong")).toHaveText("3");
    const visibleMs = performance.now() - started;
    const queries = await app.evaluate(() => globalThis.captureQueries);
    // Picker metadata places the countdown; native start checks the live target later.
    expect(queries).toHaveLength(0);
    await overlay
      .getByRole("button", { name: "取消 · Esc", exact: true })
      .click();
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
    console.log(JSON.stringify({ microphone, visibleMs, queries }));
  }
  // Hold the real engine for two seconds: the controller must already be
  // visible and honestly report startup, without waiting for capture readiness.
  await page.getByLabel("麦克风", { exact: true }).uncheck();
  await app.evaluate(({ ipcMain }) => {
    const channel = "capture:native:start";
    globalThis.originalNativeStart = ipcMain._invokeHandlers.get(channel);
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const result = await globalThis.originalNativeStart(...args);
      globalThis.recordingStartupTiming.engineReady = performance.now();
      return result;
    });
  });
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
          !controls.isVisible() &&
          !controls.webContents.isLoadingMainFrame()
        );
      }),
    )
    .toBe(true);
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.recordingStartupTiming = {};
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
    });
    controls.once("show", () => {
      globalThis.recordingStartupTiming.controlsShown = performance.now();
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
  const preparing = app
    .windows()
    .find((p) =>
      p.url().includes(encodeURIComponent("<title>TronCut 录制控制</title>")),
    );
  await expect(preparing.getByRole("status")).toHaveText("正在启动录制…");
  await expect(preparing.locator("time")).toHaveText("准备中…");
  await expect(
    preparing.getByRole("button", { name: "暂停录制", exact: true }),
  ).toBeDisabled();
  await expect(
    preparing.getByRole("button", { name: "停止录制", exact: true }),
  ).toBeDisabled();
  const controls = await recordingControls(app);
  const timing = await app.evaluate(() => globalThis.recordingStartupTiming);
  expect(timing.controlsShown).toBeLessThan(timing.engineReady);
  console.log(
    JSON.stringify({
      countdownToToolbarMs: timing.controlsShown - timing.countdownClosed,
      engineReadyAfterToolbarMs: timing.engineReady - timing.controlsShown,
    }),
  );
  await page.waitForTimeout(1000);
  await controls.getByRole("button", { name: "停止录制", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("录制完成", {
    timeout: 30000,
  });
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("capture:native:start");
    ipcMain.handle("capture:native:start", globalThis.originalNativeStart);
  });
  await page.getByRole("button", { name: "录制", exact: true }).click();
  await page.getByLabel("麦克风", { exact: true }).check();
  // A device that opens late must still be released if another request fails.
  await page.getByLabel("摄像头", { exact: true }).check();
  await page.evaluate(() => {
    globalThis.deviceEvents = [];
    navigator.mediaDevices.getUserMedia = (constraints) => {
      const kind = constraints.video ? "camera" : "microphone";
      globalThis.deviceEvents.push(`open:${kind}`);
      return new Promise((resolve, reject) => {
        setTimeout(
          () => {
            if (kind === "microphone") {
              globalThis.deviceEvents.push("failed:microphone");
              reject(new Error("startup fixture: microphone unavailable"));
            } else {
              globalThis.deviceEvents.push("ready:camera");
              resolve({
                getTracks: () => [
                  { stop: () => globalThis.deviceEvents.push("stop:camera") },
                ],
              });
            }
          },
          kind === "microphone" ? 20 : 150,
        );
      });
    };
  });
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
  console.log("并行设备准备失败后，延迟打开的摄像头已释放");
} finally {
  await app.close();
}
