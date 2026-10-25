import { _electron as electron, expect } from "@playwright/test";
import { timelineZoom } from "./timeline-zoom.mjs";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import assert from "node:assert/strict";

const root = path.resolve(`test-output/annotations-ui/run-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const raw = Buffer.alloc(640 * 360 * 3);
for (let y = 0; y < 360; y++)
  for (let x = 0; x < 640; x++) {
    const value = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? 30 : 240;
    raw.fill(value, (y * 640 + x) * 3, (y * 640 + x) * 3 + 3);
  }
await sharp(raw, { raw: { width: 640, height: 360, channels: 3 } })
  .png()
  .toFile(path.join(root, "background.png"));
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
const project = createProject("标注验收");
project.canvas = { width: 640, height: 360, fps: 10, background: "#121212" };
project.assets = [
  {
    id: "background",
    name: "background.png",
    path: "background.png",
    kind: "image",
    width: 640,
    height: 360,
    duration: 0,
    hasAudio: false,
  },
];
project.clips = [
  { ...newText("video", 0), kind: "image", assetId: "background", duration: 6 },
];
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
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, file);
  await page.getByRole("button", { name: "打开项目", exact: true }).click();
  await expect(page.locator(".preview-layer.image img")).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".preview-layer.image img")
        .evaluate((image) => image.complete && image.naturalWidth > 0),
    )
    .toBe(true);
  await page
    .locator(".tool-rail")
    .getByRole("button", { name: "标注", exact: true })
    .click();
  const canvas = page.locator(".canvas-holder .canvas");
  const save = async () => {
    const before = (await fs.stat(file)).mtimeMs;
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect
      .poll(async () => (await fs.stat(file)).mtimeMs)
      .toBeGreaterThan(before);
    await expect(page.locator(".busy-overlay")).toHaveCount(0);
    await expect(page.locator(".project-save-state")).not.toContainText("*");
    return JSON.parse(await fs.readFile(file, "utf8"));
  };
  const undo = () => page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  const reset = async () => {
    for (
      let i = 0;
      i < 12 && (await page.locator(".timeline-clip").count()) > 1;
      i++
    )
      await undo();
    await expect(page.locator(".timeline-clip")).toHaveCount(1);
  };
  const seek = async (time) => {
    const zoom = await timelineZoom(page);
    await page.locator(".ruler").click({ position: { x: time * zoom, y: 12 } });
  };
  await page.getByRole("tab", { name: "箭头标注", exact: true }).click();
  await expect(page.locator(".shape-presets > button")).toHaveCount(8);
  await page
    .getByRole("button", { name: "虚线箭头", exact: true })
    .dragTo(canvas);
  let saved = await save();
  assert(
    saved.clips.some(
      (clip) =>
        clip.shapeStyle?.lineStyle === "dashed" &&
        clip.shapeStyle.endHead === "arrow",
    ),
  );
  await page.getByLabel("标注线型", { exact: true }).selectOption("dotted");
  await page.getByLabel("标注笔宽", { exact: true }).fill("12");
  saved = await save();
  assert(
    saved.clips.some(
      (clip) =>
        clip.shapeStyle?.lineStyle === "dotted" &&
        clip.shapeStyle.strokeWidth === 12,
    ),
  );
  await page.screenshot({ path: path.join(root, "arrows.png") });
  await reset();

  await page.getByRole("tab", { name: "形状标注", exact: true }).click();
  await expect(page.locator(".shape-presets > button")).toHaveCount(9);
  await page.getByRole("button", { name: "五角星", exact: true }).click();
  assert((await save()).clips.some((clip) => clip.shape === "star"));
  await page.screenshot({ path: path.join(root, "shapes.png") });
  await reset();

  await page.getByRole("tab", { name: "草图运动", exact: true }).click();
  await expect(page.locator(".shape-presets > button")).toHaveCount(10);
  await page.getByRole("button", { name: "勾选", exact: true }).click();
  await page.getByLabel("绘制动画时长", { exact: true }).fill("2");
  const stroke = page.locator(".preview-layer.shape svg path").first();
  await seek(0.5);
  const short = await stroke.evaluate((element) => element.getTotalLength());
  await seek(1.5);
  assert(
    (await stroke.evaluate((element) => element.getTotalLength())) > short * 2,
  );
  await page.screenshot({ path: path.join(root, "sketches.png") });
  await reset();
  await seek(0);

  await page.getByRole("tab", { name: "涂鸦笔", exact: true }).click();
  await page.getByLabel("涂鸦笔笔宽", { exact: true }).fill("7");
  await page.getByRole("button", { name: "启用涂鸦笔", exact: true }).click();
  const overlay = page.getByLabel("涂鸦绘制画布", { exact: true });
  const bounds = await overlay.boundingBox();
  await page.mouse.move(
    bounds.x + bounds.width * 0.25,
    bounds.y + bounds.height * 0.4,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width * 0.45,
    bounds.y + bounds.height * 0.65,
    { steps: 15 },
  );
  await page.mouse.move(
    bounds.x + bounds.width * 0.65,
    bounds.y + bounds.height * 0.3,
    { steps: 15 },
  );
  await page.mouse.up();
  await page
    .locator(".canvas-drawing-actions")
    .getByRole("button", { name: "完成绘制", exact: true })
    .click();
  saved = await save();
  const freehand = saved.clips.find((clip) => clip.shape === "freehand");
  assert(
    freehand.drawing.enabled && freehand.drawing.strokes[0].points.length > 15,
  );
  assert.equal(freehand.shapeStyle.strokeWidth, 7);
  assert(
    freehand.drawing.strokes[0].points.every(
      (point) => point.x >= 0 && point.x <= freehand.shapeSize.width,
    ),
  );
  await page.getByRole("button", { name: "选择模式", exact: true }).click();
  await expect(overlay).toHaveCount(0);
  await page.getByLabel("绘制动画时长", { exact: true }).fill("2");
  await seek(0.5);
  const pathLength = await stroke.evaluate((element) =>
    element.getTotalLength(),
  );
  await seek(1.5);
  assert(
    (await stroke.evaluate((element) => element.getTotalLength())) >
      pathLength * 2,
  );
  await page.screenshot({ path: path.join(root, "freehand.png") });
  await save();
  await reset();
  await seek(0);

  const pixels = async () =>
    sharp(await canvas.screenshot())
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  const stats = ({ data, info }, region = [0.42, 0.42, 0.58, 0.58]) => {
    const [x1, y1, x2, y2] = region.map((p, i) =>
      Math.floor(p * (i % 2 ? info.height : info.width)),
    );
    let variation = 0,
      count = 0,
      red = 0,
      blue = 0;
    for (let y = y1; y < y2; y++)
      for (let x = x1; x < x2 - 1; x++) {
        const p = (y * info.width + x) * info.channels;
        red += data[p];
        blue += data[p + 2];
        variation += Math.abs(data[p] - data[p + info.channels]);
        count++;
      }
    return {
      variation: variation / count,
      red: red / count,
      blue: blue / count,
    };
  };
  const baseline = await pixels();
  await page.getByRole("tab", { name: "模糊和高亮", exact: true }).click();
  await expect(page.locator(".shape-presets > button")).toHaveCount(4);
  for (const [id, name] of [
    ["blur", "模糊"],
    ["spotlight", "聚光灯"],
    ["highlight", "突出显示"],
    ["pixelate", "像素化"],
  ]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.locator(`.annotation-${id}`)).toBeVisible();
    const image = await pixels();
    const actual = stats(image),
      original = stats(baseline);
    if (id === "blur" || id === "pixelate")
      assert(
        actual.variation < original.variation * 0.75,
        `${id} must alter underlying pixels: ${JSON.stringify({ actual, original })}`,
      );
    if (id === "highlight") {
      assert(actual.red > original.red + 20);
      assert(actual.blue < original.blue - 20);
    }
    if (id === "spotlight") {
      assert(Math.abs(actual.red - original.red) < 5);
      assert(
        stats(image, [0.1, 0.1, 0.2, 0.2]).red <
          stats(baseline, [0.1, 0.1, 0.2, 0.2]).red * 0.7,
      );
    }
    await page.screenshot({ path: path.join(root, `${id}.png`) });
    assert(
      (await save()).clips.some((clip) => clip.annotationEffect?.type === id),
    );
    await reset();
  }
  assert.deepEqual(errors, []);
  console.log(
    `标注分类、原生拖放、属性编辑、草图进度、涂鸦绘制与区域像素效果验证通过：${root}`,
  );
} catch (error) {
  await (
    await app.firstWindow()
  ).screenshot({ path: path.join(root, "failure.png") });
  throw error;
} finally {
  await app.close();
}
