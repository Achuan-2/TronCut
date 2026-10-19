import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(`test-output/canvas-axis-drag/run-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const bundle = await build({
  stdin: {
    contents: 'export { createProject, newText } from "./shared/model";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { createProject, newText } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const project = createProject("画布 Shift 方向约束");
project.canvas = { width: 800, height: 450, fps: 20, background: "#151719" };
project.camera = {
  transform: { x: 0.5, y: 0.5, scale: 1.5, opacity: 1 },
  keyframes: [],
};
const source = newText("titles", 0, 0, "方向约束");
source.textBox = { width: 180, height: 80 };
source.style.fontSize = 28;
source.transform = { ...source.transform, x: 0.35, y: 0.35, rotation: 18 };
source.keyframes = [
  { time: 0, value: { ...source.transform } },
  {
    time: 4,
    value: { ...source.transform, x: 0.45, y: 0.55 },
    animation: true,
  },
];
const other = newText("video", 0, 0, "另一个对象");
other.textBox = { width: 180, height: 80 };
other.style.fontSize = 24;
other.transform = { ...other.transform, x: 0.7, y: 0.7 };
project.clips = [source, other];
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
  page.on("pageerror", (error) => errors.push(error.message));
  const layer = (id) =>
    page.locator(`.canvas-holder .preview-layer[data-clip-id="${id}"]`);
  const sourceLayer = layer(source.id);
  await expect(sourceLayer).toBeVisible();
  await sourceLayer.click();
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
  const start = async () => {
    const box = await sourceLayer.boundingBox();
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    return { box, point };
  };
  const move = async (gesture, x, y, steps = 5) =>
    page.mouse.move(gesture.point.x + x, gesture.point.y + y, { steps });
  const check = async (gesture, x, y) => {
    await expect
      .poll(async () => {
        const box = await sourceLayer.boundingBox();
        return Math.max(
          Math.abs(box.x - gesture.box.x - x),
          Math.abs(box.y - gesture.box.y - y),
        );
      })
      .toBeLessThan(1);
  };
  const reset = async (gesture) => {
    await undo();
    await check(gesture, 0, 0);
  };

  // Camera zoom and object rotation must not turn screen-horizontal motion diagonal.
  await page.keyboard.down("Shift");
  let gesture = await start();
  await move(gesture, 80, 12);
  await check(gesture, 80, 0);
  await move(gesture, 40, 90);
  await check(gesture, 40, 0);
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect(sourceLayer).toHaveClass(/selected/);
  let saved = await save();
  expect(saved.clips[0].keyframes.map((frame) => frame.value.y)).toEqual(
    source.keyframes.map((frame) => frame.value.y),
  );
  expect(saved.clips[0].transform.y).toBe(source.transform.y);
  await reset(gesture);

  await page.keyboard.down("Shift");
  gesture = await start();
  await move(gesture, 8, 70);
  await check(gesture, 0, 70);
  await move(gesture, 95, 30);
  await check(gesture, 0, 30);
  await page.mouse.up();
  await page.keyboard.up("Shift");
  saved = await save();
  expect(saved.clips[0].keyframes.map((frame) => frame.value.x)).toEqual(
    source.keyframes.map((frame) => frame.value.x),
  );
  await reset(gesture);

  gesture = await start();
  await move(gesture, 40, 30);
  await check(gesture, 40, 30);
  await page.mouse.up();
  await reset(gesture);

  // Pressing/releasing/repressing Shift during one gesture switches constraints.
  gesture = await start();
  await move(gesture, 12, 35);
  await page.keyboard.down("Shift");
  await move(gesture, 20, 70);
  await check(gesture, 0, 70);
  await page.keyboard.up("Shift");
  await move(gesture, 45, 60);
  await check(gesture, 45, 60);
  await page.keyboard.down("Shift");
  await move(gesture, 80, 40, 1);
  await check(gesture, 80, 0);
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await check(gesture, 80, 0);
  await page.screenshot({ path: path.join(root, "constrained.png") });
  await reset(gesture);

  // Shift-click continues to toggle selection, while Shift-drag retains it.
  await layer(other.id).click({ modifiers: ["Shift"] });
  await expect(page.locator(".timeline-clip.selected")).toHaveCount(2);
  await sourceLayer.click({ modifiers: ["Shift"] });
  await expect(page.locator(".timeline-clip.selected")).toHaveCount(1);
  await expect(sourceLayer).not.toHaveClass(/selected/);
  await sourceLayer.click({ modifiers: ["Shift"] });
  await expect(page.locator(".timeline-clip.selected")).toHaveCount(2);
  await page.keyboard.down("Shift");
  gesture = await start();
  await move(gesture, -50, 10);
  await check(gesture, -50, 0);
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect(page.locator(".timeline-clip.selected")).toHaveCount(2);
  saved = await save();
  expect(saved.clips[1].transform).toEqual(other.transform);
  await reset(gesture);
  await page.getByTitle("重做 Ctrl+Shift+Z", { exact: true }).click();
  await check(gesture, -50, 0);
  expect(errors).toEqual([]);
  console.log(
    `Shift 水平/垂直锁定、越过对角线、途中切换、自由拖动、多选、另一轴动画、撤销重做与保存通过：${root}`,
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
