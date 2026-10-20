import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";

const root = path.resolve(`test-output/media-behaviors-${Date.now()}`);
await fs.mkdir(path.join(root, "profile"), { recursive: true });
await fs.writeFile(
  path.join(root, "profile/preferences.json"),
  JSON.stringify({
    storage: {
      projectDirectory: path.join(root, "projects"),
      backupDirectory: path.join(root, "backups"),
    },
  }),
);
await build({
  stdin: {
    contents:
      'export { createProject, newText } from "./shared/model"; export { createBehavior, mediaBehaviorPresets, mediaBehaviorStyles, behaviorTransform } from "./shared/behaviors"; export { exportVideo } from "./electron/export"; export { findBinary, runProcess } from "./electron/process";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: path.join(root, "runtime.mjs"),
});
const {
  createProject,
  newText,
  createBehavior,
  mediaBehaviorPresets,
  mediaBehaviorStyles,
  behaviorTransform,
  exportVideo,
  findBinary,
  runProcess,
} = await import(pathToFileURL(path.join(root, "runtime.mjs")).href);
const source = path.join(root, "source.png"),
  movie = path.join(root, "source.mp4");
await sharp("resources/icon.png").resize(120, 120).png().toFile(source);
await runProcess(findBinary("ffmpeg"), [
  "-y",
  "-loop",
  "1",
  "-i",
  source,
  "-t",
  "5",
  "-r",
  "15",
  "-pix_fmt",
  "yuv420p",
  movie,
]);
const project = createProject("媒体行为交互验证");
project.canvas = { width: 640, height: 360, fps: 30, background: "#000000" };
project.tracks = ["text", "image", "video"].map((id) => ({
  id,
  name: id,
  hidden: false,
  muted: false,
  locked: false,
}));
project.assets = ["image", "video"].map((kind) => ({
  id: kind,
  name: kind,
  path: kind === "image" ? source : movie,
  kind,
  width: 120,
  height: 120,
  duration: kind === "image" ? 0 : 5,
  hasAudio: false,
}));
project.clips = ["text", "image", "video"].map((kind, index) => ({
  ...newText(kind, 0, 0, "ABC"),
  id: kind,
  kind,
  duration: 5,
  ...(kind === "text" ? {} : { assetId: kind }),
  transform: {
    x: 0.25 + index * 0.25,
    y: 0.5,
    scale: kind === "text" ? 0.5 : 0.25,
    opacity: 1,
  },
}));
const file = path.join(root, "project.troncut");
await fs.writeFile(
  file,
  JSON.stringify({
    ...project,
    assets: project.assets.map((asset) => ({
      ...asset,
      path: path.basename(asset.path),
    })),
  }),
);
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: path.join(root, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
const launch = async (projectFile = file, count = 3) => {
  app = await electron.launch({ args: [".", projectFile], env });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  if (count !== null)
    await expect(page.locator(".timeline-clip")).toHaveCount(count);
  else await expect(page.locator(".timeline-clip").first()).toBeVisible();
  await page
    .locator(".tool-rail")
    .getByRole("button", { name: "行为", exact: true })
    .click();
  return page;
};
const save = async (page) => {
  await page.getByTitle("保存项目 Ctrl+S", { exact: true }).click();
  await expect(page.locator(".toast")).toContainText("项目已保存");
  await expect(page.locator(".busy-overlay")).toHaveCount(0);
  return JSON.parse(await fs.readFile(file, "utf8"));
};
try {
  let page = await launch();
  await page.getByRole("tab", { name: "媒体", exact: true }).click();
  await expect(page.locator(".behavior-card")).toHaveCount(10);
  for (const preset of mediaBehaviorPresets) {
    const card = page
      .locator(".behavior-card")
      .filter({ hasText: preset.name });
    await card.hover();
    const preview = card.locator(".behavior-card-media");
    const initial = await preview.getAttribute("style");
    await expect.poll(() => preview.getAttribute("style")).not.toBe(initial);
  }
  await page.locator(".timeline-clip.image").click();
  await page.getByRole("button", { name: "漂移", exact: true }).dblclick();
  await expect(page.getByLabel("行为类型", { exact: true })).toHaveCount(0);
  const optionLabels = () =>
    page.getByLabel("行为样式").locator("option").allTextContents();
  for (const [key, label] of [
    ["incoming", "进"],
    ["during", "期间"],
    ["outgoing", "出"],
  ]) {
    await page.getByRole("tab", { name: label, exact: true }).click();
    expect(await optionLabels()).toEqual(
      mediaBehaviorStyles[key].map(([, name]) => name),
    );
  }
  // A text preset applied to a video must match the media-tab preset on image.
  await page.getByRole("tab", { name: "文本", exact: true }).click();
  await page.locator(".timeline-clip.video").click();
  await page.getByRole("button", { name: "漂移", exact: true }).dblclick();
  let saved = await save(page);
  for (const key of ["incoming", "during", "outgoing"])
    expect(saved.clips[1].behaviors[0][key]).toEqual(
      saved.clips[2].behaviors[0][key],
    );
  await page.getByTitle("撤销 Ctrl+Z").click();
  await expect(page.locator(".clip-behavior-effect")).toHaveCount(1);
  // Exercise an actual drag from the media library onto video.
  await page.getByRole("tab", { name: "媒体", exact: true }).click();
  await page
    .getByRole("button", { name: "漂移", exact: true })
    .dragTo(page.locator(".timeline-clip.video"));
  await expect(page.locator(".clip-behavior-effect")).toHaveCount(2);
  await page.getByRole("tab", { name: "文本", exact: true }).click();
  await page.locator(".timeline-clip.text").click();
  await page.getByRole("button", { name: "切换", exact: true }).dblclick();
  for (const [key, label] of [
    ["incoming", "进"],
    ["during", "期间"],
    ["outgoing", "出"],
  ]) {
    await page.getByRole("tab", { name: label, exact: true }).click();
    await page.getByLabel("行为类型", { exact: true }).click();
    await page
      .getByRole("menuitemradio", { name: "媒体", exact: true })
      .click();
    await expect(page.getByLabel("行为类型", { exact: true })).toHaveText(
      "媒体",
    );
    expect(await optionLabels()).toEqual(
      mediaBehaviorStyles[key].map(([, name]) => name),
    );
  }
  await page.getByRole("tab", { name: "期间", exact: true }).click();
  await page.getByLabel("行为样式").selectOption("pulse");
  await page.getByLabel("永远循环").uncheck();
  await page.getByLabel("行为循环次数", { exact: true }).fill("2");
  await page.getByLabel("行为循环延迟（秒）", { exact: true }).fill("0.2");
  // Verify a switch back to character mode is possible in the same inspector.
  await page.getByLabel("行为类型", { exact: true }).click();
  await page.getByRole("menuitem", { name: "文本", exact: true }).click();
  await page
    .getByRole("menuitemradio", { name: "第一个到最后一个", exact: true })
    .click();
  await expect(
    page.getByLabel("逐字偏移（秒）", { exact: true }),
  ).toBeVisible();
  await page.locator(".timeline-clip.image .clip-behavior-effect").click();
  await page.getByLabel("行为更多选项").click();
  await page.getByRole("menuitem", { name: "添加预设", exact: true }).click();
  await page.getByLabel("预设名称", { exact: true }).fill("我的媒体漂移");
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await page.getByRole("tab", { name: "媒体", exact: true }).click();
  await expect(page.locator(".behavior-card")).toHaveCount(11);
  saved = await save(page);
  expect(saved.clips[0].behaviors[0].during).toMatchObject({
    loops: 2,
    delay: 0.2,
    loopForever: false,
  });
  await expect(
    page.getByRole("tab", { name: "媒体", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: path.join(root, "media-library.png") });
  await app.close();
  app = null;
  page = await launch();
  await page.getByRole("tab", { name: "媒体", exact: true }).click();
  await expect(page.locator(".behavior-card")).toHaveCount(11);
  await expect(page.locator(".clip-behavior-effect")).toHaveCount(3);
  expect(errors).toEqual([]);
  await app.close();
  app = null;

  // Render all ten presets through the real export pipeline and inspect frames.
  const frames = [];
  const review = createProject("媒体行为画布采样");
  review.canvas = { width: 480, height: 270, fps: 15, background: "#000000" };
  review.assets = [{ ...project.assets[0], path: path.basename(source) }];
  review.clips = [];
  for (const preset of mediaBehaviorPresets) {
    const sample = createProject(preset.name);
    sample.canvas = { width: 480, height: 270, fps: 15, background: "#000000" };
    sample.exportSettings = { encoder: "software" };
    sample.assets = [project.assets[0]];
    sample.clips = [
      {
        ...project.clips[1],
        trackId: sample.tracks[0].id,
        transform: { x: 0.5, y: 0.5, scale: 0.28, opacity: 1 },
        behaviors: [createBehavior(preset.id, 5, "image")],
      },
    ];
    await fs.writeFile(
      path.join(root, `${preset.id}.troncut`),
      JSON.stringify({ ...sample, assets: review.assets }),
    );
    review.clips.push({
      ...sample.clips[0],
      id: preset.id,
      trackId: review.tracks[0].id,
      start: review.clips.length * 5,
    });
    const output = path.join(root, `${preset.id}.mp4`);
    await exportVideo(
      sample,
      output,
      path.join(root, `render-${preset.id}`),
      false,
      AbortSignal.timeout(60000),
      () => {},
    );
    for (const time of [1 / 15, 0.2, 0.4, 3, 4.8]) {
      const frame = path.join(root, `${preset.id}-${time}.png`);
      await runProcess(findBinary("ffmpeg"), [
        "-y",
        "-ss",
        String(time),
        "-i",
        output,
        "-frames:v",
        "1",
        frame,
      ]);
      frames.push({
        input: await sharp(frame).resize(240, 135).png().toBuffer(),
        left: (frames.length % 5) * 240,
        top: Math.floor(frames.length / 5) * 135,
      });
    }
    console.log(`已导出：${preset.name}`);
  }
  await sharp({
    create: { width: 1200, height: 1350, channels: 3, background: "#000000" },
  })
    .composite(frames)
    .png()
    .toFile(path.join(root, "exports-contact.png"));
  const reviewFile = path.join(root, "all-media-presets.troncut");
  await fs.writeFile(reviewFile, JSON.stringify(review));
  page = await launch(reviewFile, null);
  for (const clip of review.clips) {
    for (const time of [1 / 15, 0.2, 0.4, 3, 4.8]) {
      await page
        .getByLabel("播放进度", { exact: true })
        .evaluate((input, time) => {
          Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
          ).set.call(input, String(time));
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }, clip.start + time);
      const pose = behaviorTransform(clip, clip.transform, time, {
        width: 270 / 480,
        height: 1,
      });
      const layer = page.locator(`.preview-layer[data-clip-id="${clip.id}"]`);
      await expect
        .poll(() => layer.evaluate((node) => parseFloat(node.style.left)))
        .toBeCloseTo(pose.x * 100, 4);
      await expect
        .poll(() => layer.evaluate((node) => parseFloat(node.style.top)))
        .toBeCloseTo(pose.y * 100, 4);
      await expect
        .poll(() => layer.evaluate((node) => Number(node.style.opacity)))
        .toBeCloseTo(pose.opacity, 4);
      const transform = await layer.evaluate((node) => node.style.transform);
      expect(transform).not.toMatch(/NaN|Infinity/);
      for (const [key, rotation] of [
        ["rotateX", pose.rotationX ?? 0],
        ["rotateY", pose.rotationY ?? 0],
        ["rotateZ", pose.rotation ?? 0],
      ]) {
        const angle = Number(
          transform.match(new RegExp(`${key}\\(([^d]+)deg\\)`))?.[1] ?? 0,
        );
        // CSSOM serializes angles with fewer significant digits than JS.
        expect(angle).toBeCloseTo(rotation, 2);
      }
    }
  }
  await page.getByRole("tab", { name: "媒体", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "媒体", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: path.join(root, "media-canvas.png") });
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      root,
      presets: 10,
      exportFrames: 50,
      canvasSamples: 50,
      rendererErrors: errors,
    }),
  );
} catch (error) {
  if (app)
    await (
      await app.firstWindow()
    )
      .screenshot({ path: path.join(root, "failure.png") })
      .catch(() => {});
  console.error("验证失败，证据目录：", root);
  throw error;
} finally {
  if (app) await app.close();
}
