import { _electron as electron, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(`test-output/preview-proxy-switch-${Date.now()}`);
const profile = path.join(root, "profile");
await fs.mkdir(root, { recursive: true });
const source = path.join(root, "source.mp4");
execFileSync(
  path.resolve(
    "resources/bin",
    process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
  ),
  [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=1920x1080:rate=30:duration=8",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    source,
  ],
  { windowsHide: true },
);
const project = {
  format: "troncut",
  version: 1,
  id: "proxy-switch",
  name: "代理切换回归",
  canvas: { width: 1920, height: 1080, fps: 30, background: "#101319" },
  tracks: [
    { id: "video", name: "轨道1", hidden: false, muted: false, locked: false },
  ],
  assets: [
    {
      id: "source",
      name: "source.mp4",
      path: "source.mp4",
      kind: "video",
      duration: 8,
      width: 1920,
      height: 1080,
      hasAudio: false,
    },
  ],
  clips: [
    {
      id: "clip",
      assetId: "source",
      trackId: "video",
      kind: "video",
      name: "clip",
      start: 0,
      duration: 8,
      sourceIn: 0,
      speed: 1,
      volume: 1,
      podcast: false,
      transform: { x: 0.5, y: 0.5, scale: 1, opacity: 1 },
      keyframes: [],
    },
  ],
  markers: [],
};
execFileSync(
  path.resolve(
    "resources/bin",
    process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
  ),
  [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=64x48:rate=10:duration=0.4",
    path.join(root, "animated.gif"),
  ],
  { windowsHide: true },
);
project.assets.push({
  id: "animated",
  name: "animated.gif",
  path: "animated.gif",
  kind: "video",
  animated: true,
  duration: 0.4,
  width: 64,
  height: 48,
  hasAudio: false,
});
const file = path.join(root, "project.troncut");
await fs.writeFile(file, JSON.stringify(project));
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["."], env });
try {
  const page = await app.firstWindow();
  // Deliver proxy availability at a controlled point during real playback.
  await app.evaluate(({ ipcMain, BrowserWindow, dialog }, file) => {
    ipcMain.removeHandler("media:preview-proxy");
    ipcMain.handle("media:preview-proxy", () => false);
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    const send = contents.send.bind(contents);
    contents.send = (channel, ...args) => {
      if (channel !== "media:preview-proxy-ready") send(channel, ...args);
    };
    globalThis.releasePreviewProxy = () =>
      send("media:preview-proxy-ready", "source");
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, file);
  await page.getByRole("button", { name: "打开项目", exact: true }).click();
  const video = page.locator(".canvas video");
  await expect
    .poll(() => video.evaluate((v) => v.readyState))
    .toBeGreaterThanOrEqual(2);
  const originalUrl = await video.getAttribute("src");
  expect(originalUrl).toContain("revision=0");
  await expect
    .poll(
      async () =>
        (await fs.readdir(path.join(profile, "preview-proxies"))).some(
          (name) => name.endsWith(".mp4") && !name.includes("partial"),
        ),
      { timeout: 30000 },
    )
    .toBe(true);
  const check = await app.evaluate(async ({ net }, url) => {
    const bytes = async (address) => [
      ...new Uint8Array(
        await (
          await net.fetch(address, { headers: { Range: "bytes=0-4095" } })
        ).arrayBuffer(),
      ),
    ];
    const original = await bytes("framecraft-media://asset/source");
    const pinned = await bytes(url);
    const proxy = await bytes(url.replace("revision=0", "revision=1"));
    return {
      originalPinned: JSON.stringify(original) === JSON.stringify(pinned),
      proxyDiffers: JSON.stringify(original) !== JSON.stringify(proxy),
    };
  }, originalUrl);
  expect(check).toEqual({ originalPinned: true, proxyDiffers: true });
  await expect
    .poll(
      async () =>
        (await fs.readdir(path.join(profile, "preview-proxies"))).some(
          (name) => name.endsWith(".webm") && !name.includes("partial"),
        ),
      { timeout: 30000 },
    )
    .toBe(true);
  expect(
    await page.evaluate(() => window.framecraft.mediaUrl("animated")),
  ).toContain("revision=1");
  await page.locator(".play-button").click();
  await app.evaluate(() => globalThis.releasePreviewProxy());
  await page.waitForTimeout(700);
  expect(await video.getAttribute("src")).toBe(originalUrl);
  const playing = await video.evaluate((v) => ({
    time: v.currentTime,
    paused: v.paused,
  }));
  expect(playing.paused).toBe(false);
  expect(playing.time).toBeGreaterThan(0.4);
  await page.locator(".play-button").click();
  await expect.poll(() => video.getAttribute("src")).toContain("revision=1");
  await expect
    .poll(() =>
      video.evaluate(
        (v) => v.readyState >= 2 && !v.seeking && v.videoWidth === 1280,
      ),
    )
    .toBe(true);
  expect(
    Math.abs((await video.evaluate((v) => v.currentTime)) - playing.time),
  ).toBeLessThan(0.2);
  console.log(
    JSON.stringify({
      root,
      check,
      playing,
      checks: "Range 来源固定、播放中不切代理、暂停后代理正确定位",
    }),
  );
} finally {
  await app.close();
}
