import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const root = path.resolve("test-output/track-drag-ui", `run-${Date.now()}`);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
const video = path.join(root, "视频.mp4");
const image = path.join(root, "图片.png");
await sharp({
  create: { width: 320, height: 180, channels: 3, background: "#76e5b5" },
})
  .png()
  .toFile(image);
await promisify(execFile)(
  path.resolve(
    "resources/bin",
    process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
  ),
  [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=320x180:r=30",
    "-t",
    "3",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    video,
  ],
  { windowsHide: true },
);
const project = {
  format: "troncut",
  version: 1,
  id: "track-drag",
  name: "轨道拖动与粘贴",
  canvas: { width: 320, height: 180, fps: 30, background: "#101319" },
  markers: [],
  tracks: ["top", "source", "dest", "bottom"].map((id, i) => ({
    id,
    name: `轨道${4 - i}`,
    hidden: false,
    muted: false,
    locked: false,
  })),
  assets: [
    {
      id: "video",
      path: video,
      name: "视频.mp4",
      kind: "video",
      duration: 3,
      width: 320,
      height: 180,
      hasAudio: false,
    },
  ],
  clips: [
    {
      id: "moving",
      trackId: "source",
      assetId: "video",
      name: "视频",
      kind: "video",
      start: 0,
      duration: 3,
      sourceIn: 0,
      speed: 1,
      volume: 1,
      podcast: false,
      transform: { x: 0.5, y: 0.5, scale: 1, opacity: 1 },
      keyframes: [],
    },
  ],
};
await fs.writeFile(
  path.join(profile, "recovery.json"),
  JSON.stringify({ project, file: null }),
);
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.env.FRAMECRAFT_PACKAGED_SMOKE === "1";
const app = await electron.launch({
  ...(packaged
    ? { executablePath: path.resolve(process.env.FRAMECRAFT_PACKAGED_APP) }
    : {}),
  args: packaged ? [] : ["."],
  env,
});
try {
  const page = await app.firstWindow(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "恢复编辑", exact: true }).click();
  await page.locator(".ruler").click({ position: { x: 65, y: 15 } });
  await expect(page.locator(".preview-layer.video video")).toBeVisible();
  const clip = page.locator(".timeline-clip.video");
  await clip.click();
  await page.locator(".timeline-scroll").evaluate((element) => {
    element.scrollTop = 70;
  });
  const from = await clip.boundingBox();
  const dest = await page
    .locator('.track-lane[data-track="dest"]')
    .boundingBox();
  const x = from.x + 60,
    y = from.y + 25,
    targetY = dest.y + 30;
  await page.evaluate(() => {
    window.draggedVideo = document.querySelector(".preview-layer.video video");
  });
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 20, targetY, { steps: 6 });
  const samples = [];
  for (let i = 0; i < 20; i++) {
    await page.mouse.move(x + 20 + (i % 2), targetY);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(resolve)),
    );
    samples.push(await clip.evaluate((element) => element.style.translate));
  }
  expect(new Set(samples)).toEqual(new Set(["0px 70px"]));
  await page.screenshot({ path: path.join(root, "drag-stable.png") });
  await page.mouse.up();
  await expect(
    page.locator('.track-lane[data-track="dest"] .timeline-clip.video'),
  ).toHaveCount(1);
  expect(
    await page.evaluate(
      () =>
        window.draggedVideo ===
        document.querySelector(".preview-layer.video video"),
    ),
  ).toBe(true);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(
    page.locator('.track-lane[data-track="source"] .timeline-clip.video'),
  ).toHaveCount(1);
  // The same pointer path into a locked destination must leave the clip in place.
  await page
    .locator(".track-header")
    .nth(2)
    .getByTitle("锁定 / 解锁轨道", { exact: true })
    .click();
  await page.locator(".timeline-scroll").evaluate((element) => {
    element.scrollTop = 70;
  });
  const original = await clip.boundingBox();
  const locked = await page
    .locator('.track-lane[data-track="dest"]')
    .boundingBox();
  await page.mouse.move(original.x + 50, original.y + 25);
  await page.mouse.down();
  await page.mouse.move(original.x + 50, locked.y + 30, { steps: 4 });
  await expect(clip).toHaveCSS("translate", "0px");
  await page.mouse.up();
  await expect(
    page.locator('.track-lane[data-track="source"] .timeline-clip.video'),
  ).toHaveCount(1);
  // Substitute native clipboard reads only. PNG persistence and all import IPC
  // execute normally, without overwriting the user's clipboard.
  await app.evaluate(({ clipboard, nativeImage }, image) => {
    clipboard.readBuffer = () => Buffer.alloc(0);
    clipboard.availableFormats = () => ["image/png"];
    clipboard.readImage = () => nativeImage.createFromPath(image);
  }, image);
  await page.locator(".timeline-toolbar").click({ position: { x: 2, y: 2 } });
  await page.keyboard.press("Control+v");
  await expect(page.locator(".timeline-clip.image")).toHaveCount(1);
  await expect(page.locator(".track-lane")).toHaveCount(4);
  await expect(
    page.locator('.track-lane[data-track="top"] .timeline-clip.image'),
  ).toHaveCount(1);
  await expect(page.locator(".timeline-clip.image.selected")).toHaveCount(1);
  await page.keyboard.press("Control+v");
  await expect(page.locator(".timeline-clip.image")).toHaveCount(2);
  await expect(page.locator(".track-lane")).toHaveCount(5);
  await expect(
    page.locator(".track-lane").first().locator(".timeline-clip.image"),
  ).toHaveCount(1);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(page.locator(".timeline-clip.image")).toHaveCount(0);
  await expect(page.locator(".track-lane")).toHaveCount(4);
  // Register the real video via the regular import path, then substitute only
  // clipboard delivery. This avoids touching Windows' Explorer file clipboard.
  await app.evaluate(({ dialog }, video) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [video] });
  }, video);
  const videos = await page.evaluate(() => window.framecraft.importMedia());
  await app.evaluate(({ ipcMain }, assets) => {
    ipcMain.removeHandler("media:clipboard");
    ipcMain.handle("media:clipboard", () => ({ assets, clipToken: null }));
  }, videos);
  await page.locator(".timeline-toolbar").click({ position: { x: 2, y: 2 } });
  await page.keyboard.press("Control+v");
  await expect(page.locator(".timeline-clip.video")).toHaveCount(2);
  await expect(page.locator(".track-lane")).toHaveCount(4);
  await expect(
    page.locator('.track-lane[data-track="top"] .timeline-clip.video'),
  ).toHaveCount(1);
  await page.keyboard.press("Control+v");
  await expect(page.locator(".timeline-clip.video")).toHaveCount(3);
  await expect(page.locator(".track-lane")).toHaveCount(5);
  await expect(
    page.locator(".track-lane").first().locator(".timeline-clip.video"),
  ).toHaveCount(1);
  expect(errors).toEqual([]);
  await page.screenshot({ path: path.join(root, "paste-top-track.png") });
  console.log(
    `跨轨道拖动连续20次位置稳定、锁定保护、撤销；图片及视频粘贴复用空白顶层或新增轨道通过：${root}`,
  );
} catch (error) {
  await app
    .windows()[0]
    ?.screenshot({ path: path.join(root, "failure.png") })
    .catch(() => {});
  console.error(`失败截图：${path.join(root, "failure.png")}`);
  throw error;
} finally {
  await app.close().catch(() => {});
}
