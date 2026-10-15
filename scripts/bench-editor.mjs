import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const animationScenario = process.argv.includes("--animation");
const root = path.resolve("test-output/editor-benchmark", `run-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const project = {
  format: "troncut",
  version: 1,
  id: "editor-benchmark",
  name: "一万片段性能验证",
  canvas: { width: 640, height: 360, fps: 30, background: "#101319" },
  assets: [],
  markers: [],
  tracks: Array.from({ length: 32 }, (_, i) => ({
    id: `track${i}`,
    name: `轨道${32 - i}`,
    hidden: false,
    muted: false,
    locked: false,
  })),
  clips: Array.from({ length: 10000 }, (_, i) => ({
    id: `clip${i}`,
    trackId: `track${i % 32}`,
    kind: "text",
    name: `片段${i}`,
    text: `片段${i}`,
    start: i,
    duration: 1,
    sourceIn: 0,
    speed: 1,
    volume: 1,
    podcast: false,
    transform: { x: 0.5, y: 0.5, scale: 1, opacity: 1 },
    keyframes: [],
    style: {
      fontSize: 50,
      color: "#ffffff",
      outline: "#000000",
      outlineWidth: 0,
      fontFamily: "Microsoft YaHei",
    },
  })),
};
if (animationScenario) {
  project.name = "复杂动画性能验证";
  project.clips = Array.from({ length: 4 }, (_, i) => {
    const transform = {
      x: 0.25 + (i % 2) * 0.5,
      y: 0.25 + Math.floor(i / 2) * 0.5,
      scale: 1,
      opacity: 1,
    };
    return {
      ...project.clips[i],
      start: 0,
      duration: 1000,
      transform,
      style: { ...project.clips[i].style, fontSize: 24 },
      keyframes: Array.from({ length: 1000 }, (_, frame) => ({
        time: frame,
        value: { ...transform, x: transform.x + Math.sin(frame) * 0.02 },
      })),
    };
  });
}
const file = path.join(root, "benchmark.troncut");
await fs.writeFile(file, JSON.stringify(project));
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: path.join(root, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const openedAt = performance.now();
const app = await electron.launch({ args: [".", file], env, timeout: 30000 });
const errors = [];
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.locator(".preview-text-content").first()).toHaveText(
    animationScenario ? "片段3" : "片段0",
    { timeout: 30000 },
  );
  const openMs = performance.now() - openedAt;
  const mountedClips = await page.locator(".timeline-clip").count();
  expect(mountedClips).toBeLessThan(200);
  await page
    .getByLabel("播放进度", { exact: true })
    .fill(animationScenario ? "800.5" : "8000.5");
  await expect(page.locator(".preview-text-content").first()).toHaveText(
    animationScenario ? "片段3" : "片段8000",
  );
  const mountedAnimations = await page.locator(".clip-animation").count();
  const layerStyle = await page
    .locator(".preview-layer.text")
    .first()
    .getAttribute("style");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const beforeMetrics = await cdp.send("Performance.getMetrics");
  await page.locator(".play-button").click();
  const timings = await page.evaluate(async () => {
    const samples = [];
    let previous = performance.now();
    const until = previous + 3000;
    await new Promise((resolve) => {
      const tick = (now) => {
        samples.push(now - previous);
        previous = now;
        if (now >= until) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    samples.splice(0, 3);
    samples.sort((a, b) => a - b);
    return {
      frames: samples.length,
      p50Ms: samples[Math.floor(samples.length * 0.5)],
      p95Ms: samples[Math.floor(samples.length * 0.95)],
      over33Ms: samples.filter((value) => value > 33.34).length,
    };
  });
  await page.locator(".play-button").click();
  const afterMetrics = await cdp.send("Performance.getMetrics");
  const metricDelta = (name) =>
    ((afterMetrics.metrics.find((m) => m.name === name)?.value ?? 0) -
      (beforeMetrics.metrics.find((m) => m.name === name)?.value ?? 0)) *
    1000;
  if (animationScenario)
    expect(
      await page.locator(".preview-layer.text").first().getAttribute("style"),
    ).not.toBe(layerStyle);
  expect(errors).toEqual([]);
  const report = {
    recordedAt: new Date().toISOString(),
    scenario: animationScenario ? "animation" : "text",
    clips: project.clips.length,
    tracks: 32,
    openMs,
    mountedClips,
    mountedAnimations,
    taskMs: metricDelta("TaskDuration"),
    scriptMs: metricDelta("ScriptDuration"),
    measurementMs: metricDelta("Timestamp"),
    timings,
    errors,
    limits:
      "Lightweight text timeline only; rAF intervals are not decoded-video FPS. No 4K or multi-stream media workload.",
  };
  await fs.writeFile(
    path.join(root, "result.json"),
    JSON.stringify(report, null, 2),
  );
  await page.screenshot({ path: path.join(root, "editor.png") });
  console.log(JSON.stringify({ root, ...report }, null, 2));
} finally {
  await app.close();
}
