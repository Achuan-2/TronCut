import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";

const root = path.resolve(`test-output/rounded-border-${Date.now()}`);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
await fs.writeFile(
  path.join(profile, "preferences.json"),
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
      'export { createProject, newText } from "./shared/model"; export { defaultVisualEffect } from "./shared/visual-effects"; export { exportFrame, exportVideo } from "./electron/export"; export { findBinary, runProcess } from "./electron/process";',
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
  defaultVisualEffect,
  exportFrame,
  exportVideo,
  findBinary,
  runProcess,
} = await import(pathToFileURL(path.join(root, "runtime.mjs")).href);
await sharp(
  Buffer.from(
    '<svg width="320" height="240"><defs><mask id="hole"><rect width="320" height="240" fill="white"/><circle cx="160" cy="120" r="30" fill="black"/></mask></defs><rect width="320" height="240" fill="#00c800" mask="url(#hole)"/></svg>',
  ),
)
  .png()
  .toFile(path.join(root, "source.png"));
const project = createProject("圆角与边框组合验证");
project.canvas = { width: 640, height: 480, fps: 10, background: "#5432b2" };
project.assets = [
  {
    id: "image",
    name: "图片",
    kind: "image",
    path: "source.png",
    width: 320,
    height: 240,
    duration: 0,
    hasAudio: false,
  },
];
project.clips = [
  {
    ...newText("video", 0),
    id: "image",
    kind: "image",
    assetId: "image",
    duration: 2,
    transform: { x: 0.5, y: 0.5, scale: 0.5, opacity: 1 },
    mediaFrame: { enabled: true, radius: 80, unit: "percent" },
    visualEffects: {
      border: { ...defaultVisualEffect("border"), color: "#ff0000", width: 40 },
    },
  },
];
const file = path.join(root, "project.troncut");
await fs.writeFile(file, JSON.stringify(project));
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
let page;
const errors = [];
const open = async () => {
  app = await electron.launch({ args: [".", file], env });
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator(".timeline-clip.image").click();
  await page.getByRole("tab", { name: "画面", exact: true }).click();
};
const pixels = async (input) => {
  const { data, info } = await sharp(input)
    .resize(640, 480)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return (x, y) => [
    ...data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3),
  ];
};
const near = (actual, expected) =>
  actual.forEach((channel, index) =>
    expect(Math.abs(channel - expected[index])).toBeLessThan(20),
  );
const background = [84, 50, 178];
const red = [255, 0, 0];
const preview = async (name) => {
  const image = await page.locator(".preview-panel .canvas").screenshot();
  await fs.writeFile(path.join(root, `${name}-preview.png`), image);
  return pixels(image);
};
const save = async () => {
  await page.getByTitle("保存项目 Ctrl+S", { exact: true }).click();
  await expect(page.locator(".toast")).toContainText("项目已保存");
  await expect(page.locator(".busy-overlay")).toHaveCount(0);
  const saved = JSON.parse(await fs.readFile(file, "utf8"));
  return {
    ...saved,
    assets: saved.assets.map((asset) => ({
      ...asset,
      path: path.resolve(root, asset.path),
    })),
  };
};
const frame = async (name, value, time = 0.5) => {
  const output = path.join(root, `${name}-export.png`);
  await exportFrame(
    value,
    time,
    output,
    path.join(root, name),
    AbortSignal.timeout(30000),
  );
  return pixels(output);
};
const rounded = (pixel) => {
  near(pixel(150, 110), background); // The old square border painted this corner red.
  near(pixel(170, 130), red);
  near(pixel(320, 110), red);
  near(pixel(294, 240), background); // Source holes do not become frame borders.
};
try {
  await open();
  rounded(await preview("rounded"));
  rounded(await frame("rounded", await save()));

  // Updating the radius and each corner must invalidate the preview filter.
  await page
    .getByRole("spinbutton", { name: "圆角 (%)", exact: true })
    .fill("0");
  near((await preview("zero-radius"))(150, 110), red);
  await page
    .getByRole("spinbutton", { name: "圆角 (%)", exact: true })
    .fill("80");
  await page.getByRole("button", { name: "圆角左上", exact: true }).click();
  near((await preview("square-top-left"))(150, 110), red);
  near((await frame("square-top-left", await save()))(150, 110), red);
  await page.getByRole("button", { name: "圆角左上", exact: true }).click();
  await page
    .getByRole("switch", { name: "启用圆角倒角", exact: true })
    .uncheck();
  near((await preview("disabled"))(150, 110), red);
  await page.getByRole("switch", { name: "启用圆角倒角", exact: true }).check();
  rounded(await preview("enabled"));

  await page.getByLabel("边框使用透明度", { exact: true }).check();
  near((await preview("alpha"))(294, 240), red);
  near((await frame("alpha", await save()))(294, 240), red);
  await page.getByLabel("边框使用透明度", { exact: true }).uncheck();
  const saved = await save();
  await app.close();
  app = null;
  await open();
  rounded(await preview("reopened"));
  expect(errors).toEqual([]);
  await app.close();
  app = null;

  // A timed round-corner effect must change the border in actual video frames.
  saved.clips[0].mediaFrame.window = { start: 0.5, end: 1.5 };
  saved.exportSettings = { encoder: "software" };
  const movie = path.join(root, "timed.mp4");
  await exportVideo(
    saved,
    movie,
    path.join(root, "video"),
    false,
    AbortSignal.timeout(30000),
    () => {},
  );
  for (const [time, color] of [
    [0.2, red],
    [0.8, background],
    [1.8, red],
  ]) {
    const output = path.join(root, `video-${time}.png`);
    await runProcess(findBinary("ffmpeg"), [
      "-y",
      "-ss",
      String(time),
      "-i",
      movie,
      "-frames:v",
      "1",
      output,
    ]);
    near((await pixels(output))(150, 110), color);
  }
  console.log(
    `圆角边框预览/截帧/视频、半径修改、单角开关、效果开关、透明度选项和保存重开通过：${root}`,
  );
} catch (error) {
  if (app)
    await page
      .screenshot({ path: path.join(root, "failure.png") })
      .catch(() => {});
  console.error(root);
  throw error;
} finally {
  if (app) await app.close();
}
