import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { recordingControls } from "./recording-controls.mjs";

const root = path.resolve(
  "test-output/recording-camera-ui",
  `run-${Date.now()}`,
);
await fs.mkdir(root, { recursive: true });
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: path.join(root, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: ["."],
  env,
});
try {
  const page = await app.firstWindow(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const target = await app.evaluate(async ({ BrowserWindow }) => {
    const target = new BrowserWindow({
      width: 480,
      height: 320,
      backgroundColor: "#ffffff",
      skipTaskbar: true,
    });
    await target.loadURL(
      "data:text/html,<title>Camera recording fixture</title><body>Camera recording fixture</body>",
    );
    return target.getMediaSourceId();
  });
  await page.evaluate(() => {
    window.cameraAcquisitions = 0;
    const original = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (constraints.video) {
        window.cameraAcquisitions++;
        // Deterministic camera stand-in; MediaRecorder and screen capture remain real.
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 360;
        const context = canvas.getContext("2d");
        let frame = 0;
        const timer = setInterval(() => {
          context.fillStyle = "#2b8b6e";
          context.fillRect(0, 0, 640, 360);
          context.fillStyle = "white";
          context.fillRect((frame++ * 6) % 600, 40, 40, 200);
        }, 33);
        const stream = canvas.captureStream(30);
        const track = stream.getVideoTracks()[0],
          stop = track.stop.bind(track);
        track.stop = () => {
          clearInterval(timer);
          stop();
        };
        return stream;
      }
      return original(constraints);
    };
  });
  await page.getByRole("button", { name: "新建录制", exact: true }).click();
  await page.getByLabel("摄像头", { exact: true }).check();
  const preview = page.locator(".camera-preview video");
  await expect
    .poll(() => preview.evaluate((video) => video.videoWidth))
    .toBeGreaterThan(0);
  await page.getByLabel("摄像头预设", { exact: true }).selectOption("circle");
  await page.getByLabel("蒙版水平位置", { exact: true }).fill("40");
  await page.getByLabel("蒙版垂直位置", { exact: true }).fill("55");
  await page.getByLabel("蒙版大小", { exact: true }).fill("80");
  await expect(preview).toHaveCSS("clip-path", /ellipse.*40% 55%/);
  await page.screenshot({ path: path.join(root, "settings-preview.png") });
  // Closing settings releases the live device, and reopening restores the preset.
  await preview.evaluate((video) => {
    window.previousCameraTracks = video.srcObject.getTracks();
  });
  await page.getByRole("button", { name: "关闭录制设置", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.previousCameraTracks.every(
          (track) => track.readyState === "ended",
        ),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "录制", exact: true }).click();
  await expect(page.getByLabel("摄像头", { exact: true })).toBeChecked();
  await expect(page.getByLabel("蒙版水平位置", { exact: true })).toHaveValue(
    "40",
  );
  await page
    .locator(`.capture-sources > button[data-source-id="${target}"]`)
    .click();
  await page.getByLabel("麦克风", { exact: true }).uncheck();
  await page.getByLabel("原生录制与可编辑鼠标", { exact: true }).uncheck();
  await page.getByLabel("录制帧率", { exact: true }).selectOption("15");
  await expect
    .poll(() => preview.evaluate((video) => video.videoWidth))
    .toBeGreaterThan(0);
  const requestsBefore = await page.evaluate(() => window.cameraAcquisitions);
  await page.getByRole("button", { name: "开始录制", exact: true }).click();
  const controls = await recordingControls(app);
  controls.on("pageerror", (error) => errors.push(error.message));
  const camera = controls.locator("#camera");
  await expect(camera).toBeVisible();
  await expect
    .poll(() => camera.evaluate((image) => image.naturalWidth))
    .toBe(320);
  await expect(camera).toHaveCSS("clip-path", /ellipse.*40% 55%/);
  const firstFrame = await camera.getAttribute("src");
  await expect.poll(() => camera.getAttribute("src")).not.toBe(firstFrame);
  expect(await page.evaluate(() => window.cameraAcquisitions)).toBe(
    requestsBefore,
  );
  await controls.screenshot({ path: path.join(root, "recording-preview.png") });
  await controls.getByRole("button", { name: "暂停录制", exact: true }).click();
  await expect(controls.getByRole("status")).toHaveText("已暂停");
  await controls.getByRole("button", { name: "继续录制", exact: true }).click();
  await expect(controls.getByRole("status")).toHaveText("正在录制");
  await controls.getByRole("button", { name: "停止录制", exact: true }).click();
  await expect(page.locator(".recorder-modal")).toHaveCount(0, {
    timeout: 30000,
  });
  await expect(page.locator(".timeline-clip.video")).toHaveCount(2, {
    timeout: 30000,
  });
  await app.evaluate(
    ({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    },
    path.join(root, "camera.troncut"),
  );
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("工程已保存", {
    timeout: 20000,
  });
  const saved = JSON.parse(
    await fs.readFile(path.join(root, "camera", "camera.troncut"), "utf8"),
  );
  const webcam = saved.clips.find((clip) => clip.recordingRole === "camera");
  expect(webcam.groupId).toBeUndefined();
  expect(webcam.visualEffects.mask).toMatchObject({
    shape: "ellipse",
    x: 0.4,
    y: 0.55,
    feather: 0,
  });
  expect(
    saved.clips.find((clip) => clip.recordingRole === "screen").groupId,
  ).toBeTruthy();
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({ root, requestsBefore, webcam, errors }, null, 2),
  );
} catch (error) {
  console.log(
    JSON.stringify(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((window) => ({
          title: window.getTitle(),
          visible: window.isVisible(),
          minimized: window.isMinimized(),
          url: window.webContents.getURL().slice(0, 160),
        })),
      ),
      null,
      2,
    ),
  );
  for (const page of app.windows()) {
    console.log((await page.locator("body").innerText()).slice(-3000));
  }
  throw error;
} finally {
  await app.close();
}
