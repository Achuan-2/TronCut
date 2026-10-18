import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(
  `test-output/keyframe-property-paste/run-${Date.now()}`,
);
await fs.mkdir(root, { recursive: true });
const bundle = await build({
  stdin: {
    contents:
      'export { createProject, newText } from "./shared/model"; export { transformAt } from "./shared/editor";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { createProject, newText, transformAt } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const project = createProject("动画端点粘贴属性");
const source = newText("titles", 0, 0, "属性来源");
source.transform = { ...source.transform, x: 0.25, y: 0.25, scale: 0.8 };
source.textBox = { width: 500, height: 160 };
source.style.color = "#ffaa44";
const target = newText("video", 0, 0, "动画目标");
target.textBox = { width: 500, height: 160 };
target.transform = { ...target.transform, x: 0.65, y: 0.65 };
target.keyframes = [
  { time: 0, value: { ...target.transform, x: 0.55 } },
  { time: 2, value: { ...target.transform, x: 0.65 } },
  { time: 4, value: { ...target.transform, x: 0.75 } },
];
project.clips = [source, target];
const file = path.join(root, "fixture.troncut");
await fs.writeFile(file, JSON.stringify(project));
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: path.join(root, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["."], env });
const errors = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, file);
  await page.getByRole("button", { name: "打开项目", exact: true }).click();
  const timeline = (id) => page.locator(`.timeline-clip[data-clip-id="${id}"]`);
  const canvas = page.locator(
    `.canvas-holder .preview-layer[data-clip-id="${target.id}"]`,
  );
  const firstArrow = timeline(target.id).locator(".clip-animation").first();
  const point = (side) => firstArrow.locator(`.animation-point.${side}`);
  const action = (name) => page.getByRole("menuitem", { name, exact: true });
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

  await timeline(source.id).click({
    button: "right",
    position: { x: 20, y: 18 },
  });
  await action("复制属性").click();
  // Reproduce the user's exact sequence: endpoint, canvas object, context menu, paste.
  await point("end").click();
  await canvas.click({ position: { x: 20, y: 20 } });
  await expect(point("end")).toHaveAttribute("aria-pressed", "true");
  await canvas.click({ button: "right", position: { x: 20, y: 20 } });
  await expect(point("end")).toHaveAttribute("aria-pressed", "true");
  await action("粘贴属性").click();
  let saved = await save();
  let pasted = saved.clips.find((clip) => clip.id === target.id);
  assert.deepEqual(pasted.transform, target.transform);
  assert.deepEqual(pasted.style, target.style);
  assert.deepEqual(pasted.keyframes[0], target.keyframes[0]);
  assert.deepEqual(pasted.keyframes[2], target.keyframes[2]);
  assert.equal(transformAt(pasted, 2).scale, source.transform.scale);
  assert.equal(transformAt(pasted, 2).x, source.transform.x);
  await expect(point("end")).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: path.join(root, "endpoint-paste.png") });
  await undo();
  saved = await save();
  assert.deepEqual(
    saved.clips.find((clip) => clip.id === target.id).keyframes,
    target.keyframes,
  );

  // The same endpoint selection also survives opening the timeline context menu.
  await point("start").click();
  await canvas.click({ position: { x: 20, y: 20 } });
  await timeline(target.id).click({
    button: "right",
    position: { x: 20, y: 18 },
  });
  await expect(point("start")).toHaveAttribute("aria-pressed", "true");
  await action("粘贴属性").click();
  saved = await save();
  pasted = saved.clips.find((clip) => clip.id === target.id);
  assert.equal(transformAt(pasted, 0).scale, source.transform.scale);
  assert.equal(transformAt(pasted, 0).x, source.transform.x);
  assert.equal(transformAt(pasted, 2).x, target.keyframes[1].value.x);
  assert.equal(transformAt(pasted, 2).scale, target.keyframes[1].value.scale);
  assert.equal(transformAt(pasted, 4).x, target.keyframes[2].value.x);
  assert.deepEqual(pasted.style, target.style);
  await undo();
  await save();

  // Seeking clears endpoint mode; ordinary property paste still updates the clip.
  const pane = await page.locator(".timeline-scroll").boundingBox();
  const ruler = await page.locator(".ruler").boundingBox();
  await page.mouse.click(pane.x + 65, ruler.y + 12);
  await timeline(target.id).click({
    button: "right",
    position: { x: 20, y: 18 },
  });
  await action("粘贴属性").click();
  saved = await save();
  pasted = saved.clips.find((clip) => clip.id === target.id);
  assert.equal(pasted.transform.scale, source.transform.scale);
  assert.equal(pasted.transform.x, source.transform.x);
  assert.equal(pasted.style.color, source.style.color);
  assert(pasted.keyframes.every((frame) => frame.value.scale === source.transform.scale));
  expect(errors).toEqual([]);
  console.log(
    `端点属性粘贴验证通过：画布与时间线右键保留红点、起止端点分别粘贴、其他关键帧与静态属性保留、撤销和普通粘贴。${root}`,
  );
} catch (error) {
  await app.windows()[0]?.screenshot({ path: path.join(root, "failure.png") });
  throw error;
} finally {
  await app.close();
}
