import { _electron as electron, expect } from "@playwright/test";
import { timelineZoom } from "./timeline-zoom.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve("test-output/drawing-pen-ui", `run-${Date.now()}`);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
const background = path.join(root, "background.png");
await sharp({
  create: { width: 640, height: 360, channels: 3, background: "#17201d" },
})
  .png()
  .toFile(background);
const project = {
  format: "troncut",
  version: 1,
  id: "drawing-pen-ui",
  name: "涂鸦笔测试",
  canvas: { width: 640, height: 360, fps: 10, background: "#121212" },
  assets: [
    {
      id: "background",
      name: "background.png",
      path: background,
      kind: "image",
      width: 640,
      height: 360,
      duration: 0,
      hasAudio: false,
    },
  ],
  markers: [],
  tracks: [
    { id: "titles", name: "轨道1", hidden: false, muted: false, locked: false },
  ],
  clips: [
    {
      id: "background-clip",
      trackId: "titles",
      assetId: "background",
      kind: "image",
      name: "background.png",
      start: 0,
      duration: 6,
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
const app = await electron.launch({ args: ["."], env });

const strokeLength = (stroke) =>
  stroke.points
    .slice(1)
    .reduce(
      (sum, point, index) =>
        sum +
        Math.hypot(
          point.x - stroke.points[index].x,
          point.y - stroke.points[index].y,
        ),
      0,
    );

try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "恢复编辑", exact: true }).click();
  await page.locator(".timeline-clip").first().click();
  await page
    .locator(".tool-rail")
    .getByRole("button", { name: "标注", exact: true })
    .click();
  await page.getByRole("tab", { name: "涂鸦笔", exact: true }).click();
  await page.getByLabel("涂鸦笔笔宽", { exact: true }).fill("8");
  await page.getByRole("button", { name: "启用涂鸦笔", exact: true }).click();

  const penButton = page.getByRole("button", {
    name: "涂鸦笔模式",
    exact: true,
  });
  await expect(penButton).toHaveAttribute("aria-pressed", "true");
  await expect(penButton).toHaveClass(/active/);
  await expect(penButton).toHaveCSS("background-color", "rgb(118, 229, 181)");

  const overlay = page.getByLabel("涂鸦绘制画布", { exact: true });
  const bounds = await overlay.boundingBox();
  const point = (x, y) => ({
    x: bounds.x + bounds.width * x,
    y: bounds.y + bounds.height * y,
  });
  const draw = async (points) => {
    const first = point(...points[0]);
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    for (const value of points.slice(1)) {
      const next = point(...value);
      await page.mouse.move(next.x, next.y, { steps: 12 });
    }
    await page.mouse.up();
  };
  const actions = page.locator(".canvas-drawing-actions");
  await draw([
    [0.2, 0.35],
    [0.3, 0.6],
    [0.42, 0.32],
  ]);
  await expect(actions).toContainText("已绘制 1 笔");
  await actions.getByRole("button", { name: "完成绘制", exact: true }).click();
  await expect(penButton).toHaveAttribute("aria-pressed", "false");

  const save = async () => {
    const target = path.join(root, `${project.name}.troncut`);
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, target);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.locator(".toast")).toContainText("项目已保存");
    return JSON.parse(
      await fs.readFile(
        path.join(root, project.name, `${project.name}.troncut`),
        "utf8",
      ),
    );
  };
  let saved = await save();
  const initial = saved.clips.find((clip) => clip.shape === "freehand");
  expect(initial.drawing.strokes).toHaveLength(1);
  expect(initial.drawing.strokes[0].points.length).toBeGreaterThan(5);

  await page.getByLabel("绘制动画时长", { exact: true }).fill("2");
  const seek = async (time) => {
    const zoom = await timelineZoom(page);
    await page.locator(".ruler").click({ position: { x: time * zoom, y: 12 } });
  };
  const previewPath = page.locator(".preview-layer.shape svg path").first();
  await seek(0.5);
  const partial = await previewPath.evaluate((path) => path.getTotalLength());
  await seek(1.5);
  const later = await previewPath.evaluate((path) => path.getTotalLength());
  expect(later).toBeGreaterThan(partial * 2);

  await seek(0.5);
  await penButton.click();
  await expect(penButton).toHaveAttribute("aria-pressed", "true");
  await expect(penButton).toHaveCSS("background-color", "rgb(118, 229, 181)");
  await expect(actions).toContainText("继续编辑 1 笔");
  const full = await overlay
    .locator("path")
    .first()
    .evaluate((path) => path.getTotalLength());
  expect(full).toBeCloseTo(strokeLength(initial.drawing.strokes[0]), 0);
  expect(full).toBeGreaterThan(partial * 2);
  await page.screenshot({
    path: path.join(root, "drawing-pen-continue.png"),
  });

  await draw([
    [0.58, 0.32],
    [0.7, 0.55],
    [0.82, 0.3],
  ]);
  await expect(actions).toContainText("继续编辑 2 笔");
  await actions
    .getByRole("button", { name: "撤销上一笔", exact: true })
    .click();
  await expect(actions).toContainText("继续编辑 1 笔");
  await draw([
    [0.58, 0.32],
    [0.7, 0.55],
    [0.82, 0.3],
  ]);
  await expect(actions).toContainText("继续编辑 2 笔");
  await actions.getByRole("button", { name: "完成绘制", exact: true }).click();
  await expect(penButton).toHaveAttribute("aria-pressed", "false");
  await expect(overlay).toHaveCount(0);

  saved = await save();
  const extended = saved.clips.find((clip) => clip.shape === "freehand");
  expect(extended.drawing.strokes).toHaveLength(2);
  expect(extended.shapeSize.width).toBeGreaterThan(initial.shapeSize.width);
  await page.screenshot({
    path: path.join(root, "drawing-pen-extended.png"),
  });
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ root, errors }, null, 2));
} finally {
  await app.close();
}
