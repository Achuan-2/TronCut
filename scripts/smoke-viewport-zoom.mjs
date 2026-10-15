import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import sharp from "sharp";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(`test-output/viewport-zoom/run-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const image = path.join(root, "green.png");
const video = path.join(root, "blue.mp4");
await sharp({
  create: { width: 320, height: 180, channels: 3, background: "#00ff00" },
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
    "color=c=blue:s=320x180:r=15",
    "-t",
    "2",
    "-pix_fmt",
    "yuv420p",
    video,
  ],
  { windowsHide: true },
);
const bundle = await build({
  stdin: {
    contents:
      'export { createProject, newTrack, newText, defaultTransform, validateProject } from "./shared/model";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { createProject, newTrack, newText, defaultTransform, validateProject } =
  await import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
  );
const project = createProject("画布与时间线缩放");
project.tracks = Array.from({ length: 8 }, (_, i) => newTrack(i));
project.assets = [
  {
    id: "image",
    name: "右侧图片",
    path: image,
    kind: "image",
    width: 320,
    height: 180,
    duration: 0,
    hasAudio: false,
  },
  {
    id: "video",
    name: "左侧视频",
    path: video,
    kind: "video",
    width: 320,
    height: 180,
    duration: 2,
    hasAudio: false,
  },
];
project.clips = project.assets.map((asset, i) => ({
  id: asset.id,
  name: asset.name,
  assetId: asset.id,
  kind: asset.kind,
  trackId: project.tracks[i].id,
  start: 0,
  duration: 40,
  sourceIn: 0,
  speed: 1,
  volume: 1,
  podcast: false,
  transform: { ...defaultTransform, x: i === 0 ? 1 : 0, scale: 0.2 },
  keyframes: [],
}));
project.clips.push({
  ...newText(project.tracks[2].id, 0, 0, "缩放边界"),
  duration: 40,
});
const profile = path.join(root, "profile");
validateProject(project);
await fs.mkdir(profile);
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
const app = await electron.launch({ args: ["."], env });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "恢复编辑", exact: true }).click();
  await expect(page.locator(".preview-layer.image img")).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".preview-layer.video video")
        .evaluate((video) => video.readyState),
    )
    .toBeGreaterThanOrEqual(2);
  const canvasZoom = page.getByLabel("画布显示比例", { exact: true });
  const timelineZoom = page.getByLabel("时间线缩放", { exact: true });
  const canvas = page.locator(".canvas");
  const holder = page.locator(".canvas-holder");
  const timeline = page.locator(".timeline-scroll");
  const numeric = async (locator) => Number(await locator.inputValue());
  await canvasZoom.selectOption("0.25");
  await holder.hover();
  await page.keyboard.press("Control+Equal");
  await expect.poll(() => numeric(canvasZoom)).toBeCloseTo(0.325, 6);
  await expect(timelineZoom).toHaveValue("65");
  await page.keyboard.press("Control+Minus");
  await expect.poll(() => numeric(canvasZoom)).toBeCloseTo(0.25, 6);
  await page.keyboard.press("Control+Shift+Equal");
  await expect.poll(() => numeric(canvasZoom)).toBeCloseTo(0.325, 6);
  await canvasZoom.selectOption("2");
  const viewport = await holder.boundingBox();
  const point = {
    x: viewport.x + viewport.width * 0.6,
    y: viewport.y + viewport.height * 0.55,
  };
  const canvasPosition = async () => {
    const bounds = await canvas.boundingBox();
    const scale = await numeric(canvasZoom);
    return { x: (point.x - bounds.x) / scale, y: (point.y - bounds.y) / scale };
  };
  const before = await canvasPosition();
  await page.mouse.move(point.x, point.y);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -120);
  await page.keyboard.up("Control");
  await expect.poll(() => numeric(canvasZoom)).toBeCloseTo(2.6, 6);
  const after = await canvasPosition();
  assert.ok(
    Math.abs(before.x - after.x) < 1 && Math.abs(before.y - after.y) < 1,
    "Canvas wheel anchor moved",
  );
  await canvasZoom.selectOption("0.25");
  await page.locator(".timeline-clip.text").click();
  const text = page.getByLabel("文本内容", { exact: true });
  await text.focus();
  await holder.hover();
  await page.keyboard.press("Control+Equal");
  await expect(canvasZoom).toHaveValue("0.25");
  await page.locator(".timeline-toolbar").click({ position: { x: 2, y: 2 } });
  await timeline.hover();
  await page.keyboard.press("Control+Equal");
  await expect.poll(() => numeric(timelineZoom)).toBeCloseTo(84.5, 4);
  await expect(canvasZoom).toHaveValue("0.25");
  await page.keyboard.press("Control+Minus");
  await expect.poll(() => numeric(timelineZoom)).toBeCloseTo(65, 4);
  await timelineZoom.fill("100");
  await timeline.evaluate((element) => {
    element.scrollLeft = 1000;
    element.scrollTop = 80;
  });
  const trackBounds = await timeline.boundingBox();
  const trackPoint = { x: trackBounds.x + 180, y: trackBounds.y + 70 };
  const timelineTime = async () =>
    ((await timeline.evaluate((element) => element.scrollLeft)) + 180) /
    (await numeric(timelineZoom));
  const time = await timelineTime();
  await page.mouse.move(trackPoint.x, trackPoint.y);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -120);
  await page.keyboard.up("Control");
  await expect.poll(() => numeric(timelineZoom)).toBeCloseTo(130, 4);
  assert.ok(
    Math.abs((await timelineTime()) - time) < 0.02,
    "Timeline wheel anchor moved",
  );
  assert.equal(await timeline.evaluate((element) => element.scrollTop), 80);
  await page.mouse.wheel(0, 120);
  await expect
    .poll(() => timeline.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(80);
  const bounds = await canvas.boundingBox();
  const screenshot = await page.screenshot({
    path: path.join(root, "outside-canvas.png"),
    scale: "css",
  });
  const sample = async (x) => [
    ...(await sharp(screenshot)
      .extract({
        left: Math.round(x),
        top: Math.round(bounds.y + bounds.height / 2 + 8),
        width: 1,
        height: 1,
      })
      .removeAlpha()
      .raw()
      .toBuffer()),
  ];
  const green = await sample(bounds.x + bounds.width + 8);
  const blue = await sample(bounds.x - 8);
  assert.ok(
    green[1] > 200 && green[0] < 30,
    `Image outside canvas is hidden: ${green}`,
  );
  assert.ok(
    blue[2] > 200 && blue[0] < 30,
    `Video outside canvas is hidden: ${blue}`,
  );
  assert.match(
    await holder.evaluate(
      (element) => getComputedStyle(element).backgroundImage,
    ),
    /conic-gradient/,
  );
  const layer = page.locator(".preview-layer.video");
  const left = (await layer.boundingBox()).x;
  await page.mouse.move(bounds.x - 8, bounds.y + bounds.height / 2 + 8);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 12, bounds.y + bounds.height / 2 + 8, {
    steps: 4,
  });
  await page.mouse.up();
  await expect
    .poll(async () => (await layer.boundingBox()).x)
    .toBeCloseTo(left + 20, 0);
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.getZoomFactor(),
    ),
    1,
  );
  assert.deepEqual(errors, []);
  console.log(
    `画布/轨道快捷键、鼠标锚点、普通滚动、输入边界及越界图片/视频显示与拖动通过：${root}`,
  );
} finally {
  await app.close();
}
