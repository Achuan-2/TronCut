import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(`test-output/bezier-pen-ui/run-${Date.now()}`);
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
const project = createProject("贝塞尔钢笔测试");
project.canvas = { width: 640, height: 360, fps: 10, background: "#17201d" };
const background = annotationClip(
  shapePresets.find((preset) => preset.id === "rectangle").template,
  "titles",
  0,
);
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
  const point = async (x, y) => {
    const bounds = await overlay.boundingBox();
    return {
      x: bounds.x + bounds.width * x,
      y: bounds.y + bounds.height * y,
    };
  };
  const click = async (x, y) => {
    const p = await point(x, y);
    await page.mouse.click(p.x, p.y);
  };
  const drag = async (from, to, modifier) => {
    const a = await point(...from),
      b = await point(...to);
    await page.mouse.move(a.x, a.y);
    if (modifier) await page.keyboard.down(modifier);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 10 });
    await page.mouse.up();
    if (modifier) await page.keyboard.up(modifier);
  };
  const center = async (locator) => {
    const bounds = await locator.boundingBox();
    return {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    };
  };
  const dragLocator = async (locator, dx, dy, modifier) => {
    const p = await center(locator);
    await page.mouse.move(p.x, p.y);
    if (modifier) await page.keyboard.down(modifier);
    await page.mouse.down();
    await page.mouse.move(p.x + dx, p.y + dy, { steps: 10 });
    await page.mouse.up();
    if (modifier) await page.keyboard.up(modifier);
  };
  const activate = async () => {
    await page
      .locator(".tool-rail")
      .getByRole("button", { name: "标注", exact: true })
      .click();
    await page.getByRole("tab", { name: "形状标注", exact: true }).click();
    await page.getByRole("button", { name: "钢笔", exact: true }).click();
    await expect(overlay).toBeVisible();
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
  const globalUndo = () =>
    page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();

  await activate();
  await click(0.2, 0.6);
  await drag([0.45, 0.25], [0.55, 0.4]);
  await drag([0.75, 0.6], [0.8, 0.45]);
  await expect(actions).toContainText("已添加 3 个顶点");
  await overlay.press("Control+Z");
  await expect(actions).toContainText("已添加 2 个顶点");
  await overlay.press("Control+Shift+Z");
  await expect(actions).toContainText("已添加 3 个顶点");
  const second = overlay.locator(
    '.canvas-polygon-vertex[data-anchor-index="1"]',
  );
  await dragLocator(second, 15, 10, "Control");
  const out = overlay.locator(
    '.canvas-polygon-handle[data-anchor-index="1"][data-handle="out"]',
  );
  const incoming = overlay.locator(
    '.canvas-polygon-handle[data-anchor-index="1"][data-handle="in"]',
  );
  const beforeIndependent = await center(incoming);
  await dragLocator(out, 20, -10, "Alt");
  const afterIndependent = await center(incoming);
  expect(afterIndependent.x).toBeCloseTo(beforeIndependent.x, 0);
  expect(afterIndependent.y).toBeCloseTo(beforeIndependent.y, 0);
  await page.screenshot({ path: path.join(root, "curve-handles.png") });

  const segment = overlay.locator('[data-segment-index="0"]');
  const insertion = await segment.evaluate((node) => {
    const point = node
      .getPointAtLength(node.getTotalLength() * 0.5)
      .matrixTransform(node.getScreenCTM());
    return { x: point.x, y: point.y };
  });
  await page.mouse.click(insertion.x, insertion.y);
  await expect(actions).toContainText("已添加 4 个顶点");
  await overlay.press("Delete");
  await expect(actions).toContainText("已添加 3 个顶点");
  await overlay.press("Control+Z");
  await expect(actions).toContainText("已添加 4 个顶点");
  await overlay.press("Control+Z");
  await expect(actions).toContainText("已添加 3 个顶点");
  await overlay.press("Control+Shift+Z");
  await expect(actions).toContainText("已添加 4 个顶点");
  await overlay
    .locator('.canvas-polygon-vertex[data-anchor-index="1"]')
    .click();
  await overlay.press("Delete");
  await expect(actions).toContainText("已添加 3 个顶点");
  await overlay.press("Enter");
  await expect(overlay).toHaveCount(0);

  let saved = await save();
  const curve = saved.clips.find(
    (clip) =>
      clip.shape === "polygon" &&
      clip.linePoints?.some((anchor) => anchor.in || anchor.out),
  );
  expect(curve).toBeTruthy();
  expect(curve.linePoints).toHaveLength(3);
  expect(
    curve.linePoints.some((anchor) => anchor.handleMode === "independent"),
  ).toBe(true);
  const curveLayer = layer(curve.id);
  await expect(curveLayer).toBeVisible();
  expect(
    await curveLayer.locator("svg path").first().getAttribute("d"),
  ).toContain("C");
  const originalPoints = curve.linePoints;
  await page.screenshot({ path: path.join(root, "curve-object.png") });

  await activate();
  await expect(actions).toContainText("编辑 3 个顶点");
  await dragLocator(second, 12, 8, "Control");
  await page.keyboard.press("Escape");
  await expect(overlay).toHaveCount(0);
  saved = await save();
  expect(saved.clips.find((clip) => clip.id === curve.id).linePoints).toEqual(
    originalPoints,
  );

  await curveLayer.click();
  await activate();
  await dragLocator(second, 18, 12, "Control");
  await actions.getByRole("button", { name: "完成形状", exact: true }).click();
  await expect(overlay).toHaveCount(0);
  saved = await save();
  const edited = saved.clips.find((clip) => clip.id === curve.id);
  expect(edited.linePoints).not.toEqual(originalPoints);
  await globalUndo();
  saved = await save();
  expect(saved.clips.find((clip) => clip.id === curve.id).linePoints).toEqual(
    originalPoints,
  );
  await page.getByTitle("重做 Ctrl+Shift+Z", { exact: true }).click();
  saved = await save();
  expect(saved.clips.find((clip) => clip.id === curve.id).linePoints).toEqual(
    edited.linePoints,
  );

  await page.getByRole("button", { name: "返回首页", exact: true }).click();
  await page.locator(".recent-project").first().click();
  await expect(curveLayer).toBeVisible();
  saved = await save();
  expect(saved.clips.find((clip) => clip.id === curve.id).linePoints).toEqual(
    edited.linePoints,
  );
  const frame = await page.evaluate(
    (value) => window.framecraft.captureFrame(value, 0),
    saved,
  );
  const pixels = await sharp(frame.path).removeAlpha().raw().toBuffer();
  let cyan = 0;
  for (let index = 0; index < pixels.length; index += 3)
    if (
      pixels[index] < 80 &&
      pixels[index + 1] > 140 &&
      pixels[index + 2] > 170
    )
      cyan++;
  expect(cyan).toBeGreaterThan(100);
  await fs.copyFile(frame.path, path.join(root, "curve-export.png"));
  expect(errors).toEqual([]);
  console.log(
    `贝塞尔曲线、手柄、插入删除、撤销重做、再编辑与保存截帧通过：${root}`,
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
