import { _electron as electron, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(`test-output/preview-media-switch-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const bundledFfmpeg = path.resolve("resources/bin/ffmpeg.exe");
const ffmpeg = process.env.FRAMECRAFT_FFMPEG ??
  (await fs.access(bundledFfmpeg).then(() => bundledFfmpeg, () => "ffmpeg"));
for (const color of ["red", "blue"]) {
  execFileSync(ffmpeg, [
    "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
    "-i", `color=c=${color}:s=320x180:r=30:d=4`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(root, `${color}.mp4`),
  ], { windowsHide: true });
}
const clip = (id, assetId, start, duration, sourceIn) => ({
  id, assetId, trackId: "video", kind: "video", name: id,
  start, duration, sourceIn, speed: 1, volume: 1, podcast: false,
  transform: { x: 0.5, y: 0.5, scale: 1, opacity: 1 }, keyframes: [],
});
const project = {
  format: "troncut", version: 1, id: "preview-switch", name: "预览切换验证",
  canvas: { width: 640, height: 360, fps: 30, background: "#101319" },
  tracks: [{ id: "video", name: "轨道1", hidden: false, muted: false, locked: false }],
  assets: ["red", "blue", "missing"].map((id) => ({
    id, name: id, path: `${id}.mp4`, kind: "video", duration: 4,
    width: 320, height: 180, hasAudio: false,
  })),
  clips: [
    clip("red-a", "red", 0, 1, 0.3),
    clip("red-b", "red", 1, 1, 1.5),
    clip("blue", "blue", 2, 2, 0.7),
    clip("missing", "missing", 4, 1, 0),
  ],
  markers: [],
};
const file = path.join(root, "project.troncut");
await fs.writeFile(file, JSON.stringify(project));
const env = {
  ...process.env, FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: path.join(root, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [".", file], env });
const errors = [];
let page;
try {
  // Playback must not depend on this redundant IPC, even if it is unavailable.
  await app.evaluate(({ ipcMain }) => {
    globalThis.previewMediaUrlCalls = 0;
    ipcMain.removeHandler("media:url");
    ipcMain.handle("media:url", () => {
      globalThis.previewMediaUrlCalls++;
      throw new Error("Preview must resolve its playback URL synchronously");
    });
  });
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.locator(".timeline-clip.video")).toHaveCount(4);
  await page.evaluate(() => {
    window.previewOfflineFlashes = [];
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element &&
              (node.matches(".canvas .offline") || node.querySelector(".canvas .offline"))) {
            window.previewOfflineFlashes.push(node.textContent);
          }
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
  const ruler = page.locator(".ruler");
  const seek = (time) => ruler.click({ position: { x: time * 65, y: 12 } });
  const video = page.locator(".canvas .preview-layer:not([data-preview-preloading]) video");
  const checkFrame = async (id, time, channel) => {
    await expect(page.locator(`.canvas [data-clip-id="${id}"] video`)).toHaveCount(1);
    await expect.poll(() => video.evaluate((node, targetTime) =>
      node.readyState >= 2 && !node.seeking && Math.abs(node.currentTime - targetTime) < 0.06,
    time)).toBe(true);
    const pixel = await video.evaluate((node) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d");
      context.drawImage(node, 0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    });
    expect(pixel[channel]).toBeGreaterThan(200);
    expect(pixel[channel === 0 ? 2 : 0]).toBeLessThan(40);
    await expect(page.locator(".canvas .preview-layer:not([data-preview-preloading]) .offline")).toHaveCount(0);
  };
  await seek(0.4);
  await checkFrame("red-a", 0.7, 0);
  const original = await video.elementHandle();
  await seek(1.4);
  await checkFrame("red-b", 1.9, 0);
  expect(await video.evaluate((node, previous) => node === previous, original)).toBe(true);
  for (const time of [2.5, 0.6, 3.2, 1.2, 2.2]) {
    await seek(time);
    await checkFrame(
      time >= 2 ? "blue" : time >= 1 ? "red-b" : "red-a",
      time >= 2 ? 0.7 + time - 2 : time >= 1 ? 1.5 + time - 1 : 0.3 + time,
      time >= 2 ? 2 : 0,
    );
  }
  const bounds = await ruler.boundingBox();
  await page.mouse.move(bounds.x + 0.3 * 65, bounds.y + 12);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 3.5 * 65, bounds.y + 12, { steps: 35 });
  await page.mouse.move(bounds.x + 0.5 * 65, bounds.y + 12, { steps: 35 });
  await page.mouse.up();
  await checkFrame("red-a", 0.8, 0);
  expect(await page.evaluate(() => window.previewOfflineFlashes)).toEqual([]);
  expect(await app.evaluate(() => globalThis.previewMediaUrlCalls)).toBe(0);
  await seek(4.4);
  await expect(page.locator(".canvas .preview-layer:not([data-preview-preloading]) .offline")).toContainText("素材离线");
  await seek(2.5);
  await checkFrame("blue", 1.2, 2);
  expect(errors).toEqual([]);
  await page.screenshot({ path: path.join(root, "preview.png") });
  console.log(JSON.stringify({ root, checks: "跨视频定位与拖动无离线闪烁、实际解码帧与定位正确、拆分复用视频、真正离线提示", errors }));
} catch (error) {
  await page?.screenshot({ path: path.join(root, "failure.png") }).catch(() => {});
  throw error;
} finally {
  await app.close();
}
