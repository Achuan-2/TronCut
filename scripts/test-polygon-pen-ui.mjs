import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(`test-output/polygon-pen-ui/run-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const bundle = await build({
  stdin: {
    contents:
      'export { createProject } from "./shared/model"; export { annotationClip, shapePresets } from "./shared/annotations";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { createProject, annotationClip, shapePresets } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const project = createProject("钢笔工具测试");
project.canvas = { width: 640, height: 360, fps: 10, background: "#121212" };
project.camera = {
  transform: { x: 0.5, y: 0.5, scale: 1.5, opacity: 1 },
  keyframes: [],
};
const background = annotationClip(
  shapePresets.find((preset) => preset.id === "rectangle").template,
  "titles",
  0,
);
background.name = "背景";
background.duration = 20;
background.shapeSize = { width: 640, height: 360 };
background.fill = "#17201d";
background.shapeStyle = { ...background.shapeStyle, strokeWidth: 0 };
project.clips = [background];
const file = path.join(root, "fixture.troncut");
await fs.writeFile(file, JSON.stringify(project));
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: path.join(root, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [".", file], env });
const errors = [];

try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  const overlay = page.getByLabel("钢笔绘制画布", { exact: true });
  const actions = page.locator(".canvas-drawing-actions");
  const layer = (id) =>
    page.locator(`.canvas-holder .preview-layer[data-clip-id="${id}"]`);
  const openShapes = async () => {
    await page
      .locator(".tool-rail")
      .getByRole("button", { name: "标注", exact: true })
      .click();
    await page.getByRole("tab", { name: "形状标注", exact: true }).click();
  };
  const activate = async () => {
    await openShapes();
    await page.getByRole("button", { name: "钢笔", exact: true }).click();
    await expect(overlay).toBeVisible();
    await expect(
      page.getByRole("button", { name: "钢笔", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  };
  const clickPoint = async (x, y) => {
    const bounds = await overlay.boundingBox();
    await page.mouse.click(
      bounds.x + bounds.width * x,
      bounds.y + bounds.height * y,
    );
  };
  const doubleClickPoint = async (x, y) => {
    const bounds = await overlay.boundingBox();
    await page.mouse.dblclick(
      bounds.x + bounds.width * x,
      bounds.y + bounds.height * y,
    );
  };
  const save = async () => {
    const before = (await fs.stat(file)).mtimeMs;
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect
      .poll(async () => (await fs.stat(file)).mtimeMs)
      .toBeGreaterThan(before);
    await expect(page.locator(".busy-overlay")).toHaveCount(0);
    return JSON.parse(await fs.readFile(file, "utf8"));
  };
  const undo = () => page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  const center = async (locator) => {
    const bounds = await locator.boundingBox();
    return {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    };
  };

  await openShapes();
  await expect(page.locator(".shape-presets > button")).toHaveCount(9);
  await activate();
  await clickPoint(0.4, 0.4);
  await clickPoint(0.65, 0.4);
  await clickPoint(0.65, 0.6);
  await expect(actions).toContainText("已添加 3 个顶点");
  await clickPoint(0.52, 0.6);
  await expect(actions).toContainText("已添加 4 个顶点");
  await overlay.press("Control+Z");
  await expect(actions).toContainText("已添加 3 个顶点");
  await clickPoint(0.52, 0.6);
  await clickPoint(0.52, 0.75);
  await clickPoint(0.4, 0.75);
  await expect(actions).toContainText("已添加 6 个顶点");
  await expect(layer(background.id).locator(".resize-handle")).toHaveCount(0);
  await page.screenshot({ path: path.join(root, "polygon-draft.png") });
  await overlay.press("Enter");
  await expect(overlay).toHaveCount(0);

  let saved = await save();
  let polygon = saved.clips.find((clip) => clip.shape === "polygon");
  expect(polygon.linePoints).toHaveLength(6);
  expect(polygon.transform.scale).toBe(1);
  expect(Math.abs(polygon.transform.x * 640 - 330.666667)).toBeLessThan(1);
  expect(Math.abs(polygon.transform.y * 360 - 198)).toBeLessThan(1);
  expect(Math.abs(polygon.shapeSize.width - 124.666667)).toBeLessThan(1);
  expect(Math.abs(polygon.shapeSize.height - 102)).toBeLessThan(1);
  expect(polygon.drawing).toBeUndefined();
  const originalPoints = polygon.linePoints;
  const polygonLayer = layer(polygon.id);
  await expect(polygonLayer).toBeVisible();

  await undo();
  await expect(polygonLayer).toHaveCount(0);
  await page.getByTitle("重做 Ctrl+Shift+Z", { exact: true }).click();
  await expect(polygonLayer).toBeVisible();
  await polygonLayer.click();
  await expect(polygonLayer.locator(".resize-handle")).toHaveCount(8);
  let point = await center(polygonLayer);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 18, point.y + 12, { steps: 8 });
  await page.mouse.up();
  saved = await save();
  expect(
    saved.clips.find((clip) => clip.id === polygon.id).transform.x,
  ).not.toBe(polygon.transform.x);

  const beforeResize = saved.clips.find((clip) => clip.id === polygon.id);
  const resize = polygonLayer.locator(".resize-handle.se");
  point = await center(resize);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 24, point.y + 16, { steps: 8 });
  await page.mouse.up();
  saved = await save();
  const resized = saved.clips.find((clip) => clip.id === polygon.id);
  expect(resized.transform.scale).toBeGreaterThan(beforeResize.transform.scale);
  expect(resized.linePoints).toEqual(originalPoints);

  const rotate = polygonLayer.getByRole("button", {
    name: "旋转选中对象",
    exact: true,
  });
  const origin = await center(polygonLayer);
  point = await center(rotate);
  const dx = point.x - origin.x,
    dy = point.y - origin.y;
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  for (let index = 1; index <= 12; index++) {
    const angle = ((30 * index) / 12) * (Math.PI / 180);
    await page.mouse.move(
      origin.x + dx * Math.cos(angle) - dy * Math.sin(angle),
      origin.y + dx * Math.sin(angle) + dy * Math.cos(angle),
    );
  }
  await page.mouse.up();
  await page.getByLabel("标注填充颜色", { exact: true }).fill("#ff0000");
  await page.getByLabel("标注描边颜色", { exact: true }).fill("#00ff00");
  await page.getByLabel("标注笔宽", { exact: true }).fill("6");
  saved = await save();
  polygon = saved.clips.find((clip) => clip.id === polygon.id);
  expect(polygon.transform.rotation).toBeCloseTo(30, 0);
  expect(polygon.fill).toBe("#ff0000");
  expect(polygon.shapeStyle.stroke).toBe("#00ff00");
  expect(polygon.shapeStyle.strokeWidth).toBe(6);
  expect(polygon.linePoints).toEqual(originalPoints);
  await page.screenshot({ path: path.join(root, "polygon-object.png") });

  await page.getByRole("button", { name: "返回首页", exact: true }).click();
  await page.locator(".recent-project").first().click();
  await expect(polygonLayer).toBeVisible();
  const reopened = await save();
  expect(
    reopened.clips.find((clip) => clip.id === polygon.id).linePoints,
  ).toEqual(originalPoints);
  const frame = await page.evaluate(
    (value) => window.framecraft.captureFrame(value, 0),
    reopened,
  );
  const pixels = await sharp(frame.path).removeAlpha().raw().toBuffer();
  let red = 0,
    green = 0;
  for (let index = 0; index < pixels.length; index += 3) {
    if (
      pixels[index] > 180 &&
      pixels[index + 1] < 100 &&
      pixels[index + 2] < 100
    )
      red++;
    if (
      pixels[index] < 100 &&
      pixels[index + 1] > 150 &&
      pixels[index + 2] < 100
    )
      green++;
  }
  expect(red).toBeGreaterThan(500);
  expect(green).toBeGreaterThan(20);
  await fs.copyFile(frame.path, path.join(root, "polygon-export.png"));

  await activate();
  await clickPoint(0.3, 0.3);
  await clickPoint(0.4, 0.3);
  await doubleClickPoint(0.5, 0.5);
  await expect(overlay).toHaveCount(0);
  saved = await save();
  expect(saved.clips.filter((clip) => clip.shape === "polygon")).toHaveLength(
    2,
  );
  const doubled = saved.clips.filter((clip) => clip.shape === "polygon").at(-1);
  expect(doubled.linePoints).toHaveLength(3);
  await undo();
  await expect(layer(doubled.id)).toHaveCount(0);

  await activate();
  await clickPoint(0.3, 0.3);
  await clickPoint(0.5, 0.3);
  await clickPoint(0.5, 0.5);
  await clickPoint(0.3, 0.5);
  await clickPoint(0.3, 0.3);
  await expect(overlay).toHaveCount(0);
  saved = await save();
  const closed = saved.clips.filter((clip) => clip.shape === "polygon").at(-1);
  expect(closed.linePoints).toHaveLength(4);
  await undo();

  await activate();
  await clickPoint(0.3, 0.3);
  await clickPoint(0.4, 0.3);
  await clickPoint(0.5, 0.3);
  await actions.getByRole("button", { name: "完成形状", exact: true }).click();
  await expect(actions).toContainText("面积不为零");
  await page.keyboard.press("Escape");
  await expect(overlay).toHaveCount(0);

  await activate();
  await clickPoint(0.3, 0.3);
  await clickPoint(0.4, 0.4);
  await page.keyboard.press("Escape");
  await expect(overlay).toHaveCount(0);

  await activate();
  await clickPoint(0.35, 0.35);
  await page.getByRole("button", { name: "涂鸦笔模式", exact: true }).click();
  await expect(overlay).toHaveCount(0);
  await expect(page.getByLabel("涂鸦绘制画布", { exact: true })).toBeVisible();
  await activate();
  await expect(actions).toContainText("已添加 0 个顶点");
  await page.keyboard.press("Escape");
  saved = await save();
  expect(saved.clips.filter((clip) => clip.shape === "polygon")).toHaveLength(
    1,
  );
  expect(saved.clips.some((clip) => clip.shape === "freehand")).toBe(false);
  expect(errors).toEqual([]);
  console.log(
    `钢笔绘制、闭合、变换、取消、模式切换、保存重开与截帧通过：${root}`,
  );
} catch (error) {
  await app
    .windows()[0]
    ?.screenshot({ path: path.join(root, "failure.png") })
    .catch(() => {});
  throw error;
} finally {
  await app.close();
}
