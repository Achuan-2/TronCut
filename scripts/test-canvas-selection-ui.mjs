import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(`test-output/canvas-selection/run-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const bundle = await build({
  stdin: {
    contents:
      'export { createProject, newText } from "./shared/model"; export { annotationClip, arrowPresets } from "./shared/annotations";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { createProject, newText, annotationClip, arrowPresets } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const project = createProject("选框旋转与箭头控制点");
project.canvas = { width: 1000, height: 600, fps: 20, background: "#151719" };
project.camera = {
  transform: { x: 0.5, y: 0.5, scale: 1.25, opacity: 1 },
  keyframes: [],
};
const text = newText("titles", 0, 0, "拖动上方手柄旋转");
text.textBox = { width: 280, height: 85 };
text.style.fontSize = 28;
text.transform = { ...text.transform, x: 0.35, y: 0.32, rotation: 18 };
text.keyframes = [
  { time: 0, value: { ...text.transform } },
  { time: 4, value: { ...text.transform, x: 0.4 }, animation: true },
];
const arrow = annotationClip(arrowPresets[1].template, "video", 0);
arrow.shapeSize = { width: 320, height: 120 };
arrow.transform = { ...arrow.transform, x: 0.65, y: 0.68, rotation: -12 };
project.clips = [text, arrow];
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
  page.on("pageerror", (e) => errors.push(e.message));
  const layer = (id) =>
    page.locator(`.canvas-holder .preview-layer[data-clip-id="${id}"]`);
  const center = async (locator) => {
    const b = await locator.boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const near = async (locator, target) => {
    await expect
      .poll(async () => {
        const p = await center(locator);
        return Math.hypot(p.x - target.x, p.y - target.y);
      })
      .toBeLessThan(1);
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
  const textLayer = layer(text.id);
  await expect(textLayer).toBeVisible();
  await textLayer.click();
  await expect(textLayer.locator(".resize-handle")).toHaveCount(8);
  const rotate = async (
    degrees,
    shift = false,
    cancel = false,
    target = textLayer,
  ) => {
    const handle = target.getByRole("button", {
      name: "旋转选中对象",
      exact: true,
    });
    const origin = await center(target),
      p = await center(handle);
    const radians = (degrees * Math.PI) / 180;
    const dx = p.x - origin.x,
      dy = p.y - origin.y;
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    if (shift) await page.keyboard.down("Shift");
    for (let i = 1; i <= 12; i++) {
      const angle = (radians * i) / 12;
      await page.mouse.move(
        origin.x + dx * Math.cos(angle) - dy * Math.sin(angle),
        origin.y + dx * Math.sin(angle) + dy * Math.cos(angle),
      );
    }
    await expect(target.locator(".rotation-angle")).toBeVisible();
    if (cancel) await handle.dispatchEvent("pointercancel");
    await page.mouse.up();
    if (shift) await page.keyboard.up("Shift");
  };
  const textCenter = await center(textLayer);
  await rotate(73);
  let saved = await save();
  expect(saved.clips[0].transform.rotation).toBeCloseTo(91, 0);
  expect(saved.clips[0].transform.x).toBe(text.transform.x);
  expect(saved.clips[0].transform.y).toBe(text.transform.y);
  expect(saved.clips[0].keyframes.map((f) => f.value.x)).toEqual(
    text.keyframes.map((f) => f.value.x),
  );
  await near(textLayer, textCenter);
  await undo();
  await rotate(73, true);
  saved = await save();
  expect(saved.clips[0].transform.rotation).toBe(90);
  await undo();
  await rotate(50, false, true);
  saved = await save();
  expect(saved.clips[0].transform.rotation).toBe(18);

  const arrowLayer = layer(arrow.id);
  const shaft = arrowLayer.locator(".line-hit-area path");
  const point = await center(shaft);
  await page.mouse.click(point.x, point.y);
  const start = arrowLayer.getByRole("button", {
    name: "调整箭头起点",
    exact: true,
  });
  const end = arrowLayer.getByRole("button", {
    name: "调整箭头终点",
    exact: true,
  });
  const bend = arrowLayer.getByRole("button", {
    name: "调整箭头弯曲",
    exact: true,
  });
  await expect(start).toBeVisible();
  await expect(arrowLayer.locator(".resize-handle")).toHaveCount(3);
  expect(
    await arrowLayer.evaluate((el) => getComputedStyle(el, "::after").display),
  ).toBe("none");
  const moveHandle = async (handle, dx, dy, check, cancel = false) => {
    const p = await center(handle);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + dx, p.y + dy, { steps: 10 });
    await check?.({ x: p.x + dx, y: p.y + dy });
    if (cancel) await handle.dispatchEvent("pointercancel");
    await page.mouse.up();
  };
  const initialStart = await center(start),
    initialEnd = await center(end);
  await rotate(55, false, false, arrowLayer);
  saved = await save();
  expect(saved.clips[1].transform.rotation).toBeCloseTo(43, 0);
  expect(saved.clips[1].shapeSize).toEqual(arrow.shapeSize);
  await undo();
  await near(start, initialStart);
  await near(end, initialEnd);
  await moveHandle(end, 55, -35, async (target) => {
    await near(start, initialStart);
    await near(end, target);
  });
  await near(start, initialStart);
  saved = await save();
  expect(saved.clips[1].linePoints.length).toBe(33);
  expect(saved.clips[1].transform.rotation).toBe(-12);
  await undo();
  await near(end, initialEnd);
  const initialBend = await center(bend);
  await moveHandle(bend, 12, -65, async (target) => {
    await near(start, initialStart);
    await near(end, initialEnd);
    await near(bend, target);
  });
  saved = await save();
  expect(saved.clips[1].linePoints[16].y).not.toBeCloseTo(
    saved.clips[1].linePoints[0].y,
  );
  const bentSvg = await arrowLayer.locator(".preview-line-art").innerHTML();
  await page.screenshot({ path: path.join(root, "selection-controls.png") });
  await undo();
  await near(bend, initialBend);
  await page.getByTitle("重做 Ctrl+Shift+Z", { exact: true }).click();
  await expect(arrowLayer.locator(".preview-line-art")).toHaveJSProperty(
    "innerHTML",
    bentSvg,
  );
  await moveHandle(start, -25, 15, undefined, true);
  await near(start, initialStart);
  // The transparent hit corridor also permits moving a thin shaft as a whole.
  const hitPoint = await shaft.evaluate((node) => {
    const p = node.getPointAtLength(node.getTotalLength() * 0.25);
    return {
      x: p.matrixTransform(node.getScreenCTM()).x,
      y: p.matrixTransform(node.getScreenCTM()).y,
    };
  });
  const bentPoints = saved.clips[1].linePoints;
  await page.mouse.move(hitPoint.x, hitPoint.y);
  await page.mouse.down();
  await page.mouse.move(hitPoint.x + 18, hitPoint.y + 14, { steps: 5 });
  await page.mouse.up();
  await near(start, { x: initialStart.x + 18, y: initialStart.y + 14 });
  await near(end, { x: initialEnd.x + 18, y: initialEnd.y + 14 });
  saved = await save();
  expect(saved.clips[1].linePoints).toEqual(bentPoints);
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, file);
  await page.getByRole("button", { name: "项目", exact: true }).click();
  await page.getByRole("button", { name: "导入项目", exact: true }).click();
  await expect(arrowLayer.locator(".preview-line-art")).toHaveJSProperty(
    "innerHTML",
    bentSvg,
  );
  const restored = await shaft.evaluate((node) => {
    const p = node
      .getPointAtLength(node.getTotalLength() * 0.5)
      .matrixTransform(node.getScreenCTM());
    return { x: p.x, y: p.y };
  });
  await page.mouse.click(restored.x, restored.y);
  await expect(
    arrowLayer.getByRole("button", { name: "调整箭头弯曲", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  console.log(
    `旋转、Shift 吸附、取消、端点锚定、中点弯曲、撤销重做与保存通过：${root}`,
  );
} catch (error) {
  await (
    await app.firstWindow()
  )
    .screenshot({ path: path.join(root, "failure.png") })
    .catch(() => {});
  throw error;
} finally {
  await app.close();
}
