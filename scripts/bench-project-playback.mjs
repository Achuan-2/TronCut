import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const projectArg = process.argv[2];
if (!projectArg) {
  console.error(
    "Usage: node scripts/bench-project-playback.mjs <project.troncut> [startSeconds]",
  );
  process.exit(1);
}

const projectPath = path.resolve(projectArg);
const startAt = Number(process.argv[3] ?? 6.5);
const sampleMs = Number(process.env.TRONCUT_BENCH_MS ?? 5000);
const root = path.resolve("test-output/project-playback", `run-${Date.now()}`);
const profile = process.env.TRONCUT_BENCH_PROFILE
  ? path.resolve(process.env.TRONCUT_BENCH_PROFILE)
  : path.join(root, "profile");
await fs.mkdir(root, { recursive: true });
await fs.mkdir(profile, { recursive: true });

const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: profile,
};
delete env.ELECTRON_RUN_AS_NODE;

const openedAt = performance.now();
const app = await electron.launch({
  args: [".", projectPath],
  env,
  timeout: 30000,
});
const errors = [];

try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => errors.push(error.message));

  await expect(page.locator(".preview-panel")).toBeVisible();
  await expect
    .poll(() => page.locator(".preview-layer").count())
    .toBeGreaterThan(0);
  const openMs = performance.now() - openedAt;

  await page.getByLabel("播放进度", { exact: true }).fill(String(startAt));
  await expect
    .poll(async () =>
      Number(await page.getByLabel("播放进度", { exact: true }).inputValue()),
    )
    .toBeCloseTo(startAt, 2);
  if (process.env.TRONCUT_BENCH_WAIT_PROXY === "1") {
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            [...document.querySelectorAll(".preview-panel video")].every(
              (video) =>
                video.readyState >= 2 &&
                (video.videoWidth <= 1280 || video.videoHeight <= 720),
            ),
          ),
        { timeout: 120_000 },
      )
      .toBe(true);
  }

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 1000 });
  const before = await cdp.send("Performance.getMetrics");
  await cdp.send("Profiler.start");
  await page.locator(".play-button").click();
  const timings = await page.evaluate(async (durationMs) => {
    const intervals = [];
    let previous = performance.now();
    const until = previous + durationMs;
    await new Promise((resolve) => {
      const tick = (now) => {
        intervals.push(now - previous);
        previous = now;
        if (now >= until) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    intervals.splice(0, 3);
    intervals.sort((a, b) => a - b);
    const percentile = (fraction) =>
      intervals[
        Math.min(intervals.length - 1, Math.floor(intervals.length * fraction))
      ];
    return {
      frames: intervals.length,
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      over33Ms: intervals.filter((value) => value > 33.34).length,
      over50Ms: intervals.filter((value) => value > 50).length,
    };
  }, sampleMs);
  await page.locator(".play-button").click();
  const profile = await cdp.send("Profiler.stop");
  const after = await cdp.send("Performance.getMetrics");
  const metricDelta = (name) =>
    ((after.metrics.find((metric) => metric.name === name)?.value ?? 0) -
      (before.metrics.find((metric) => metric.name === name)?.value ?? 0)) *
    1000;

  const preview = await page.evaluate(async () => {
    const video = document.querySelector(".preview-panel video");
    const videoStates = [];
    for (const item of document.querySelectorAll(".preview-panel video")) {
      const id = new URL(item.currentSrc).pathname.slice(1);
      videoStates.push({
        width: item.videoWidth,
        height: item.videoHeight,
        src: item.currentSrc,
        proxyAvailable:
          (await window.framecraft?.previewProxyAvailable(
            decodeURIComponent(id),
          )) ?? false,
      });
    }
    return {
      layers: document.querySelectorAll(".preview-layer").length,
      videos: document.querySelectorAll(".preview-panel video").length,
      videoStates,
      audio: document.querySelectorAll(".preview-panel audio").length,
      timelineClips: document.querySelectorAll(".timeline-clip").length,
      quality: video?.getVideoPlaybackQuality
        ? {
            totalVideoFrames: video.getVideoPlaybackQuality().totalVideoFrames,
            droppedVideoFrames:
              video.getVideoPlaybackQuality().droppedVideoFrames,
          }
        : null,
    };
  });

  const report = {
    recordedAt: new Date().toISOString(),
    projectPath,
    startAt,
    sampleMs,
    openMs,
    timings,
    preview,
    taskMs: metricDelta("TaskDuration"),
    scriptMs: metricDelta("ScriptDuration"),
    styleMs: metricDelta("RecalcStyleDuration"),
    layoutMs: metricDelta("LayoutDuration"),
    heapUsedMb:
      ((after.metrics.find((metric) => metric.name === "JSHeapUsedSize")
        ?.value ?? 0) -
        (before.metrics.find((metric) => metric.name === "JSHeapUsedSize")
          ?.value ?? 0)) /
      (1024 * 1024),
    cpuProfile: summarizeProfile(profile.profile),
    errors,
    limits:
      "Electron desktop playback sampling. rAF intervals reflect main-thread responsiveness, not guaranteed decoded-video frames on every machine.",
  };
  await fs.writeFile(
    path.join(root, "result.json"),
    JSON.stringify(report, null, 2),
  );
  await page.screenshot({ path: path.join(root, "playback.png") });
  console.log(JSON.stringify({ root, ...report }, null, 2));
} finally {
  await app.close();
}

function summarizeProfile(profile) {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const selfTime = new Map();
  for (const sample of profile.samples ?? []) {
    const node = byId.get(sample);
    if (!node) continue;
    const frame = node.callFrame;
    const key = `${frame.functionName || "(anonymous)"} @ ${frame.url || "(native)"}:${frame.lineNumber + 1}`;
    selfTime.set(key, (selfTime.get(key) ?? 0) + 1);
  }
  const total = profile.samples?.length ?? 0;
  return [...selfTime.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([functionName, samples]) => ({
      functionName,
      samples,
      percent: total ? (samples / total) * 100 : 0,
    }));
}
