import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { recordingControls } from "./recording-controls.mjs";

const root = path.resolve(
  "test-output/recording-camera-ui",
  `run-${Date.now()}`,
);
await fs.mkdir(root, { recursive: true });
await fs.mkdir(path.join(root, "profile"), { recursive: true });
await fs.writeFile(path.join(root, "profile", "preferences.json"), JSON.stringify({
  storage: { projectDirectory: path.join(root, "Projects") },
}));
const bundle = await build({
  stdin: { contents: 'export { createProject } from "./shared/model";', resolveDir: process.cwd() },
  bundle: true, platform: "node", format: "esm", write: false,
});
const { createProject } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
await fs.writeFile(path.join(root, "profile", "recovery.json"), JSON.stringify({
  project: createProject("摄像头存储测试"), file: null,
}));
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
async function floatingPage(title) {
  const encoded = encodeURIComponent(`<title>${title}</title>`);
  await expect
    .poll(() => app.windows().some((page) => page.url().includes(encoded)))
    .toBe(true);
  return app.windows().find((page) => page.url().includes(encoded));
}

const previewDetails = () =>
  app.evaluate(({ BrowserWindow, screen }) => {
    const camera = BrowserWindow.getAllWindows().find(
      (window) => window.getTitle() === "TronCut 摄像头预览",
    );
    const controls = BrowserWindow.getAllWindows().find(
      (window) => window.getTitle() === "TronCut 录制控制",
    );
    if (!camera || !controls) return null;
    return {
      visible: camera.isVisible(),
      movable: camera.isMovable(),
      bounds: camera.getBounds(),
      controlsBounds: controls.getBounds(),
      area: screen.getDisplayMatching(controls.getBounds()).workArea,
      handle:
        process.platform === "win32"
          ? camera.getNativeWindowHandle().readBigUInt64LE().toString()
          : "",
    };
  });
try {
  const page = await app.firstWindow(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const target = await app.evaluate(
    async ({ BrowserWindow, dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
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
    },
    path.join(root, "camera.troncut"),
  );
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
        window.currentCameraTracks = stream.getVideoTracks();
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
  await page.getByRole("button", { name: "恢复编辑", exact: true }).click();
  await page.getByRole("button", { name: "录制", exact: true }).click();
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
  const mirror = page.getByLabel("镜像摄像头画面", { exact: true });
  await expect(mirror).not.toBeChecked();
  await mirror.check();
  await expect(preview).toHaveCSS("transform", "matrix(-1, 0, 0, 1, 0, 0)");
  // The element is transformed, so its local mask moves to 60% to stay at 40%
  // on screen, matching the fixed mask position used after recording.
  await expect(preview).toHaveCSS("clip-path", /ellipse.*60% 55%/);
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
  await expect(
    page.getByLabel("镜像摄像头画面", { exact: true }),
  ).toBeChecked();
  await page
    .locator(`.capture-sources > button[data-source-id="${target}"]`)
    .click();
  await page.getByLabel("麦克风", { exact: true }).uncheck();
  await page.getByLabel("原生录制与可编辑鼠标", { exact: true }).uncheck();
  await page.getByLabel("录制帧率", { exact: true }).selectOption("15");
  await expect
    .poll(() => preview.evaluate((video) => video.videoWidth))
    .toBeGreaterThan(0);
  // Both windows and live frames must appear before the countdown ends.
  await page.getByRole("button", { name: "开始录制", exact: true }).click();
  const startingControls = await floatingPage("TronCut 录制控制");
  const startingPreview = await floatingPage("TronCut 摄像头预览");
  await expect(startingControls.getByRole("status")).toHaveText(
    "正在启动录制…",
  );
  await expect(
    startingControls.getByRole("button", { name: "暂停录制", exact: true }),
  ).toBeDisabled();
  await expect
    .poll(() =>
      startingPreview
        .locator("#camera")
        .evaluate((image) => image.naturalWidth),
    )
    .toBe(320);
  const beforeCountdownEnd = await previewDetails();
  expect(beforeCountdownEnd.visible).toBe(true);
  expect(beforeCountdownEnd.movable).toBe(true);
  expect(beforeCountdownEnd.bounds.x).toBeGreaterThan(
    beforeCountdownEnd.controlsBounds.x +
    beforeCountdownEnd.controlsBounds.width,
  );
  // Electron's outer bounds can include a few DIPs of native window padding.
  const rightGap =
    beforeCountdownEnd.area.x +
    beforeCountdownEnd.area.width -
    beforeCountdownEnd.bounds.x -
    beforeCountdownEnd.bounds.width;
  expect(rightGap).toBeGreaterThanOrEqual(16);
  expect(rightGap).toBeLessThanOrEqual(32);
  await expect(startingControls.getByRole("status")).toHaveText(
    "正在启动录制…",
  );
  await page.evaluate(() => window.framecraft.cancelRecordingCountdown());
  await expect(
    page.getByRole("button", { name: "开始录制", exact: true }),
  ).toBeEnabled();
  expect(await previewDetails()).toBeNull();
  expect(
    await fs.readdir(path.join(root, "profile", "recordings")).catch(() => []),
  ).toHaveLength(0);
  await expect
    .poll(() =>
      preview.evaluate(
        (video) => video.srcObject.getVideoTracks()[0].readyState,
      ),
    )
    .toBe("live");
  const requestsBefore = await page.evaluate(() => window.cameraAcquisitions);
  await page.getByRole("button", { name: "开始录制", exact: true }).click();
  const controls = await recordingControls(app);
  controls.on("pageerror", (error) => errors.push(error.message));
  const previewWindow = await floatingPage("TronCut 摄像头预览");
  previewWindow.on("pageerror", (error) => errors.push(error.message));
  const camera = previewWindow.locator("#camera");
  await expect(camera).toBeVisible();
  await expect
    .poll(() => camera.evaluate((image) => image.naturalWidth))
    .toBe(320);
  await expect(camera).toHaveCSS("clip-path", /ellipse.*60% 55%/);
  await expect(camera).toHaveCSS("transform", "matrix(-1, 0, 0, 1, 0, 0)");
  const firstFrame = await camera.getAttribute("src");
  await expect.poll(() => camera.getAttribute("src")).not.toBe(firstFrame);
  expect(await page.evaluate(() => window.cameraAcquisitions)).toBe(
    requestsBefore,
  );
  if (process.platform === "win32") {
    const before = await previewDetails();
    const { stdout } = await promisify(execFile)(
      "powershell.exe",
      [
        "-NoProfile",
        "-File",
        path.resolve("scripts/inspect-recording-border.ps1"),
        "-OverlayHandle",
        before.handle,
      ],
      { windowsHide: true },
    );
    const native = JSON.parse(stdout.trim());
    expect(native.affinity).toBe(0x11);
    expect(native.topAtCenter).toBe(true);
    const drag = await promisify(execFile)(
      "powershell.exe",
      [
        "-NoProfile",
        "-File",
        path.resolve("scripts/drag-recording-window.ps1"),
        "-WindowHandle",
        before.handle,
      ],
      { windowsHide: true },
    );
    await expect
      .poll(async () => (await previewDetails()).bounds.x)
      .toBeLessThan(before.bounds.x - 20);
    expect((await previewDetails()).controlsBounds).toEqual(
      before.controlsBounds,
    );
    console.log(
      JSON.stringify({ native, drag: JSON.parse(drag.stdout.trim()) }),
    );
  }
  const movedBounds = (await previewDetails()).bounds;
  await controls
    .getByRole("button", { name: "隐藏摄像头预览", exact: true })
    .click();
  await expect(
    controls.getByRole("button", { name: "显示摄像头预览", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => (await previewDetails()).visible).toBe(false);
  const elapsedBefore = await controls.locator("time").textContent();
  await expect
    .poll(() => controls.locator("time").textContent())
    .not.toBe(elapsedBefore);
  expect((await previewDetails()).visible).toBe(false);
  expect(
    await page.evaluate(() =>
      window.currentCameraTracks.every((track) => track.readyState === "live"),
    ),
  ).toBe(true);
  await controls
    .getByRole("button", { name: "显示摄像头预览", exact: true })
    .click();
  await expect.poll(async () => (await previewDetails()).visible).toBe(true);
  expect((await previewDetails()).bounds).toEqual(movedBounds);
  expect(await page.evaluate(() => window.cameraAcquisitions)).toBe(
    requestsBefore,
  );
  await expect.poll(() => camera.getAttribute("src")).not.toBe(firstFrame);
  await previewWindow.screenshot({
    path: path.join(root, "floating-camera-preview.png"),
  });
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
  await expect.poll(previewDetails).toBeNull();
  const projectFile = (await page.evaluate(() => window.framecraft.recentProjects()))[0].file;
  const media = path.join(path.dirname(projectFile), "media");
  const filesBeforeSave = (await fs.readdir(media)).sort();
  expect(filesBeforeSave.filter((file) => file.endsWith(".webm"))).toHaveLength(2);
  expect(filesBeforeSave.some((file) => file.includes(".raw.webm"))).toBe(false);
  expect(await fs.readdir(path.join(root, "profile", "recordings")).catch(() => [])).toEqual([]);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("项目已保存", {
    timeout: 20000,
  });
  const saved = JSON.parse(
    await fs.readFile(projectFile, "utf8"),
  );
  expect((await fs.readdir(media)).filter((file) => file.endsWith(".webm")).sort())
    .toEqual(filesBeforeSave.filter((file) => file.endsWith(".webm")));
  const webcam = saved.clips.find((clip) => clip.recordingRole === "camera");
  expect(webcam.groupId).toBeUndefined();
  expect(webcam.visualEffects.mask).toMatchObject({
    shape: "ellipse",
    x: 0.4,
    y: 0.55,
    feather: 0,
  });
  expect(webcam.effects.flipX).toBe(true);
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
