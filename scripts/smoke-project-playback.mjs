import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

if (!process.argv[2]) {
  throw new Error(
    "Usage: node scripts/smoke-project-playback.mjs <JSON-project.troncut>",
  );
}
const projectPath = path.resolve(process.argv[2]);
const project = JSON.parse(await fs.readFile(projectPath, "utf8"));
const duration = Math.max(
  ...project.clips.map((clip) => clip.start + clip.duration),
);
const root = path.resolve(
  `test-output/project-continuous-playback-${Date.now()}`,
);
await fs.mkdir(root, { recursive: true });
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: path.join(root, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const opened = performance.now();
const app = await electron.launch({ args: [".", projectPath], env });
const errors = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.locator(".preview-panel")).toBeVisible();
  await expect(page.locator(".preview-layer").first()).toBeVisible();
  const openMs = performance.now() - opened;
  // UI test runs can lose OS focus to the editor running this script. Keep the
  // compositor active so background throttling doesn't masquerade as dropped frames.
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.webContents.setBackgroundThrottling(false);
    window.show();
    window.focus();
  });
  await page.getByLabel("播放进度", { exact: true }).fill("0");
  await page.evaluate(() => {
    window.mediaEvents = [];
    for (const name of ["error", "waiting", "stalled"])
      document.addEventListener(
        name,
        (event) => {
          const media = event.target;
          if (!(media instanceof HTMLMediaElement) || !media.closest(".canvas"))
            return;
          window.mediaEvents.push({
            event: name,
            clip: media.closest("[data-clip-id]")?.dataset.clipId,
            preloading: !!media.closest("[data-preview-preloading]"),
            time: media.currentTime,
            error: media.error?.message,
          });
        },
        true,
      );
  });
  await page.locator(".play-button").click();
  const playback = await page.evaluate(
    async ({ clips, tracks, duration }) => {
      const visible = new Set(
        tracks
          .filter(
            (track) =>
              !track.hidden && (!tracks.some((t) => t.solo) || track.solo),
          )
          .map((track) => track.id),
      );
      const expected = clips.filter(
        (clip) => clip.kind === "video" && visible.has(clip.trackId),
      );
      const samples = new Map(expected.map((clip) => [clip.id, []]));
      const intervals = [];
      let previous = performance.now(),
        sampled = -1;
      const deadline = previous + (duration + 15) * 1000;
      await new Promise((resolve, reject) => {
        const tick = (now) => {
          intervals.push(now - previous);
          previous = now;
          const time = Number(
            document.querySelector(".playback-progress").value,
          );
          if (time - sampled >= 0.1) {
            sampled = time;
            for (const clip of expected) {
              if (
                time < clip.start + 0.25 ||
                time >= clip.start + clip.duration - 0.15
              )
                continue;
              const video = document.querySelector(
                `[data-clip-id="${CSS.escape(clip.id)}"] video`,
              );
              samples.get(clip.id).push({
                playhead: time,
                time: video?.currentTime,
                paused: video?.paused,
                ready: video?.readyState,
                seeking: video?.seeking,
                width: video?.videoWidth,
                frames: video?.getVideoPlaybackQuality().totalVideoFrames,
                dropped: video?.getVideoPlaybackQuality().droppedVideoFrames,
                error: video?.error?.message,
                drift: video
                  ? Math.abs(
                      video.currentTime -
                        (clip.sourceIn + (time - clip.start) * clip.speed),
                    )
                  : null,
              });
            }
          }
          if (time >= duration - 0.04) resolve();
          else if (now > deadline)
            reject(new Error(`Playback stopped at ${time}`));
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      intervals.splice(0, 3);
      intervals.sort((a, b) => a - b);
      return {
        frames: intervals.length,
        p50Ms: intervals[Math.floor(intervals.length * 0.5)],
        p95Ms: intervals[Math.floor(intervals.length * 0.95)],
        over50Ms: intervals.filter((ms) => ms > 50).length,
        clips: [...samples].map(([id, values]) => ({ id, samples: values })),
        events: window.mediaEvents,
      };
    },
    { clips: project.clips, tracks: project.tracks, duration },
  );
  // Scroll every track into view; virtualization must preserve the complete
  // scroll range and mount clip controls again when a track becomes visible.
  const timeline = await page.evaluate(async () => {
    const scroll = document.querySelector(".timeline-scroll");
    const result = [];
    for (const lane of document.querySelectorAll(".track-lane")) {
      scroll.scrollTop = lane.offsetTop - 36;
      scroll.dispatchEvent(new Event("scroll"));
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      result.push({
        track: lane.dataset.track,
        clips: lane.querySelectorAll(".timeline-clip").length,
      });
    }
    scroll.scrollTop = 0;
    return {
      tracks: result,
      mounted: document.querySelectorAll(".timeline-clip").length,
    };
  });
  for (const time of [8, 13, 30.8, 35]) {
    if (time >= duration) continue;
    await page.getByLabel("播放进度", { exact: true }).fill(String(time));
    await expect
      .poll(() =>
        page
          .locator(
            ".canvas .preview-layer:not([data-preview-preloading]) video",
          )
          .evaluateAll((videos) =>
            videos.every((video) => video.readyState >= 2 && !video.seeking),
          ),
      )
      .toBe(true);
    await page.screenshot({ path: path.join(root, `frame-${time}.png`) });
  }
  const report = { projectPath, openMs, duration, playback, timeline, errors };
  await fs.writeFile(
    path.join(root, "result.json"),
    JSON.stringify(report, null, 2),
  );
  await page.screenshot({ path: path.join(root, "complete.png") });
  console.log(
    JSON.stringify(
      {
        root,
        openMs,
        duration,
        p50Ms: playback.p50Ms,
        p95Ms: playback.p95Ms,
        over50Ms: playback.over50Ms,
        clips: playback.clips.map(({ id, samples }) => ({
          id,
          samples: samples.length,
          maxDrift: Math.max(...samples.map((s) => s.drift ?? Infinity)),
          stalled: samples.filter(
            (s) => !s.width || s.paused || s.ready < 2 || s.error,
          ).length,
          frames: samples.at(-1)?.frames - samples[0]?.frames,
        })),
        errors,
      },
      null,
      2,
    ),
  );
  expect(errors).toEqual([]);
  for (const { id, samples } of playback.clips) {
    expect(samples.length, id).toBeGreaterThan(2);
    expect(
      samples.filter((s) => !s.width || s.paused || s.ready < 2 || s.error),
      id,
    ).toEqual([]);
    expect(
      samples.at(-1).frames - samples[0].frames,
      `${id} decoded frames`,
    ).toBeGreaterThan(5);
    expect(
      Math.max(...samples.map((s) => s.drift)),
      `${id} A/V drift`,
    ).toBeLessThan(0.4);
  }
} finally {
  await app.close();
}
