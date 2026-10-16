import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

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
const app = await electron.launch({ args: ["."], env });
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
  await expect(page.getByLabel("原生录制与可编辑鼠标", { exact: true })).toBeChecked();
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
    console.log(JSON.stringify({ microphone, visibleMs, queries }));
  }
  // A device that opens late must still be released if another request fails.
  await page.getByLabel("摄像头", { exact: true }).check();
  await page.evaluate(() => {
    globalThis.deviceEvents = [];
    navigator.mediaDevices.getUserMedia = (constraints) => {
      const kind = constraints.video ? "camera" : "microphone";
      globalThis.deviceEvents.push(`open:${kind}`);
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          if (kind === "microphone") {
            globalThis.deviceEvents.push("failed:microphone");
            reject(new Error("startup fixture: microphone unavailable"));
          } else {
            globalThis.deviceEvents.push("ready:camera");
            resolve({ getTracks: () => [{ stop: () => globalThis.deviceEvents.push("stop:camera") }] });
          }
        }, kind === "microphone" ? 20 : 150);
      });
    };
  });
  await page.getByRole("button", { name: "开始录制", exact: true }).click();
  await expect(page.locator(".recorder-modal .error-box")).toContainText("microphone unavailable");
  expect(await page.evaluate(() => globalThis.deviceEvents)).toEqual([
    "open:microphone", "open:camera", "failed:microphone", "ready:camera", "stop:camera",
  ]);
  console.log("并行设备准备失败后，延迟打开的摄像头已释放");
} finally {
  await app.close();
}
