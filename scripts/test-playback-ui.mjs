import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const root = path.resolve("test-output/playback-ui", `run-${Date.now()}`);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
const source = path.join(root, "播放测试.mp4");
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
    "testsrc2=size=640x360:rate=30:duration=45",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=45",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-g",
    "150",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    source,
  ],
  { windowsHide: true },
);
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["."], env });
const errors = [];
const results = [];
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await app.evaluate(({ dialog }, source) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [source],
    });
  }, source);
  await page
    .getByRole("button", { name: "导入媒体", exact: true })
    .first()
    .click();
  await expect(page.locator(".asset-card")).toHaveCount(1);
  await page.locator(".asset-card").dblclick();
  const video = page.locator(".preview-panel video");
  await expect(video).toHaveCount(1);
  await expect
    .poll(() => video.evaluate((media) => media.readyState))
    .toBeGreaterThanOrEqual(2);
  const rangeResponse = await app.evaluate(
    async ({ net }, url) => {
      const response = await net.fetch(url, {
        headers: { Range: "bytes=1000-1999" },
      });
      return {
        status: response.status,
        range: response.headers.get("content-range"),
        length: (await response.arrayBuffer()).byteLength,
      };
    },
    await video.getAttribute("src"),
  );
  expect(rangeResponse.status).toBe(206);
  expect(rangeResponse.range).toMatch(/^bytes 1000-1999\//);
  expect(rangeResponse.length).toBe(1000);
  await page.evaluate(() => {
    const media = document.querySelector(".preview-panel video");
    window.playbackEvents = [];
    for (const name of [
      "play",
      "playing",
      "pause",
      "seeking",
      "seeked",
      "waiting",
      "error",
    ])
      media.addEventListener(name, () =>
        window.playbackEvents.push({
          name,
          at: performance.now(),
          time: media.currentTime,
          ready: media.readyState,
        }),
      );
  });
  const snapshot = () =>
    video.evaluate((media) => ({
      time: media.currentTime,
      frames: media.getVideoPlaybackQuality().totalVideoFrames,
      audioBytes: media.webkitAudioDecodedByteCount,
      paused: media.paused,
      seeking: media.seeking,
      ready: media.readyState,
      error: media.error?.message,
      playhead: Number(document.querySelector(".playback-progress").value),
    }));
  const play = page.locator(".play-button");
  for (let cycle = 0; cycle < 4; cycle++) {
    if (cycle === 2) {
      await page.getByLabel("播放进度", { exact: true }).fill("20");
      await expect
        .poll(async () => Math.abs((await snapshot()).time - 20))
        .toBeLessThan(0.1);
    }
    await play.click();
    const before = await snapshot();
    await page.waitForTimeout(1500);
    const after = await snapshot();
    results.push({ cycle, before, after });
    await play.click();
    await page.waitForTimeout(350);
    const paused = await snapshot();
    await page.waitForTimeout(350);
    const still = await snapshot();
    expect(Math.abs(paused.time - after.time)).toBeLessThan(0.3);
    results.push({ cycle, paused, still });
  }
  const events = await page.evaluate(() => window.playbackEvents);
  await fs.writeFile(
    path.join(root, "result.json"),
    JSON.stringify({ rangeResponse, results, events, errors }, null, 2),
  );
  console.log(
    JSON.stringify({ root, rangeResponse, results, errors }, null, 2),
  );
  for (const result of results) {
    if (result.after) {
      expect(result.after.time - result.before.time).toBeGreaterThan(0.8);
      expect(result.after.frames - result.before.frames).toBeGreaterThan(15);
      expect(
        result.after.audioBytes - result.before.audioBytes,
      ).toBeGreaterThan(0);
      expect(Math.abs(result.after.time - result.after.playhead)).toBeLessThan(
        0.3,
      );
    } else {
      expect(result.still.paused).toBe(true);
      expect(Math.abs(result.still.time - result.paused.time)).toBeLessThan(
        0.03,
      );
    }
  }
  expect(errors).toEqual([]);
} finally {
  await app.close();
}
