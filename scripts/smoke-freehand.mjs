import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(`test-output/freehand-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const bundled = await build({
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
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const project = createProject("多笔涂鸦验证");
const base = newText(project.tracks[0].id, 0, 0, "");
base.duration = 8;
project.clips = [base];
const file = path.join(root, "project.troncut");
await fs.writeFile(file, JSON.stringify(project));
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: path.join(root, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.FRAMECRAFT_PACKAGED_APP;
const app = await electron.launch({
  ...(executablePath ? { executablePath: path.resolve(executablePath) } : {}),
  args: executablePath ? [file] : [".", file],
  env,
});
const errors = [];
let page;
try {
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.locator(".timeline-clip")).toHaveCount(1);
  await page.getByRole("button", { name: "涂鸦笔模式", exact: true }).click();
  await expect(page.locator(".tool-rail .selected")).toHaveText("标注");
  const penTab = page.getByRole("tab", { name: "涂鸦笔", exact: true });
  await expect(penTab).toHaveAttribute("aria-selected", "true");
  await expect(penTab).toBeInViewport();
  const picker = await page
    .getByLabel("涂鸦笔颜色", { exact: true })
    .boundingBox();
  const palette = await page
    .getByRole("group", { name: "涂鸦笔常用颜色", exact: true })
    .boundingBox();
  assert.ok(
    palette.y >= picker.y + picker.height,
    "常用色板应位于颜色选择器下方",
  );
  const categoryBounds = await page
    .locator('.annotation-categories [role="tab"]')
    .evaluateAll((elements) =>
      elements.map((element) => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      }),
    );
  assert.ok(
    categoryBounds.every(
      (bounds) =>
        Math.abs(bounds.width - categoryBounds[0].width) < 1 &&
        bounds.height === categoryBounds[0].height,
    ),
  );
  assert.equal(categoryBounds[0].y, categoryBounds[2].y);
  assert.equal(categoryBounds[3].y, categoryBounds[5].y);
  await page.getByRole("tab", { name: "文字标注", exact: true }).click();
  await page
    .locator(".tool-rail")
    .getByRole("button", { name: "媒体", exact: true })
    .click();
  await page.getByRole("button", { name: "涂鸦笔模式", exact: true }).click();
  await expect(penTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".tool-rail .selected")).toHaveText("标注");
  await page.getByRole("button", { name: "选择模式", exact: true }).click();
  await expect(page.locator(".annotations-panel .pen-brush-card")).toHaveCount(
    5,
  );
  const zoom = Number(await page.getByLabel("时间线缩放").inputValue());
  await page.locator(".ruler").click({ position: { x: zoom, y: 12 } });
  const time = () => page.getByLabel("播放进度", { exact: true }).inputValue();
  const start = await time();
  await page.getByRole("button", { name: "启用涂鸦笔", exact: true }).click();
  const overlay = page.getByLabel("涂鸦绘制画布");
  const bounds = await overlay.boundingBox();
  const draw = async (y, offset = 0) => {
    await page.mouse.move(
      bounds.x + bounds.width * (0.25 + offset),
      bounds.y + bounds.height * y,
    );
    await page.mouse.down();
    await page.mouse.move(
      bounds.x + bounds.width * (0.55 + offset),
      bounds.y + bounds.height * (y - 0.1),
      { steps: 12 },
    );
    await page.mouse.up();
  };
  await draw(0.35);
  await expect(page.locator(".timeline-clip")).toHaveCount(1);
  await page
    .locator(".annotations-panel")
    .getByRole("button", { name: "霓虹笔笔刷", exact: true })
    .click();
  await page.getByRole("button", { name: "笔色 #4bc5ed", exact: true }).click();
  await draw(0.55);
  await draw(0.7);
  await page.getByRole("button", { name: "撤销上一笔", exact: true }).click();
  await expect(page.locator(".canvas-drawing-actions")).toContainText(
    "已绘制 2 笔",
  );
  await page.screenshot({ path: path.join(root, "drawing.png") });
  await page
    .locator(".canvas-drawing-actions")
    .getByRole("button", { name: "完成绘制", exact: true })
    .click();
  await expect(overlay).toHaveCount(0);
  assert.equal(await time(), start, "完成绘制不应移动播放头");
  await expect(page.locator(".timeline-clip.shape")).toHaveCount(1);
  const inspectorTabs = page.getByRole("tablist", { name: "片段属性", exact: true });
  const annotationTab = inspectorTabs.getByRole("tab", { name: "标注", exact: true });
  const frameTab = inspectorTabs.getByRole("tab", { name: "画面", exact: true });
  await expect(annotationTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#inspector-annotation")).toBeVisible();
  await expect(page.locator("#inspector-video")).toBeHidden();
  await frameTab.click();
  await expect(page.locator("#inspector-video")).toBeVisible();
  await expect(page.locator("#inspector-annotation")).toBeHidden();
  await page.keyboard.press("End");
  await expect(annotationTab).toBeFocused();
  await expect(annotationTab).toHaveAttribute("aria-selected", "true");
  const shape = page.locator(".timeline-clip.shape");
  const layer = page.locator(".canvas .preview-layer.shape");
  const paths = layer.locator("svg path");
  await expect(paths).toHaveCount(5);
  const save = async () => {
    await page.getByTitle("保存工程 Ctrl+S", { exact: true }).click();
    await expect(page.locator(".project-save-state")).not.toContainText("*");
    return JSON.parse(await fs.readFile(file, "utf8"));
  };
  let saved = await save();
  let clip = saved.clips.find((clip) => clip.shape === "freehand");
  assert.equal(clip.drawing.strokes.length, 2);
  assert.equal(clip.drawing.strokes[0].style.brush, "round");
  assert.equal(clip.drawing.strokes[1].style.brush, "neon");
  assert.equal(clip.drawing.strokes[1].style.stroke, "#4bc5ed");
  const id = clip.id;
  const drawing = shape.locator(
    '.clip-animation[data-animation-kind="drawing"]',
  );
  await expect(drawing).toHaveCount(1);
  const end = drawing.locator(".animation-point.end");
  const endpoint = await end.boundingBox();
  await page.mouse.move(
    endpoint.x + endpoint.width / 2,
    endpoint.y + endpoint.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    endpoint.x + endpoint.width / 2 + zoom,
    endpoint.y + endpoint.height / 2,
    { steps: 12 },
  );
  await page.mouse.up();
  saved = await save();
  clip = saved.clips.find((clip) => clip.id === id);
  assert.ok(
    Math.abs(clip.drawing.duration - 2) < 0.05,
    "拖动绘制箭头终点改变时长",
  );
  // Add an overlapping transform animation using the existing UI.
  await page
    .locator(".ruler")
    .click({ position: { x: (Number(start) + 1) * zoom, y: 12 } });
  await page
    .locator(".tool-rail")
    .getByRole("button", { name: "动画", exact: true })
    .click();
  await page.getByRole("tab", { name: "动画", exact: true }).click();
  await page.getByRole("button", { name: "添加动画", exact: true }).click();
  await page.getByLabel("缩放 (%)", { exact: true }).fill("150");
  await page.getByLabel("缩放 (%)", { exact: true }).press("Enter");
  await expect(
    shape.locator('.clip-animation[data-animation-kind="transform"]'),
  ).toHaveCount(1);
  await expect(
    shape.locator('.clip-animation[data-animation-kind="drawing"]'),
  ).toHaveCount(1);
  const lanes = await shape
    .locator(".clip-animations")
    .evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().y),
    );
  assert.ok(Math.abs(lanes[0] - lanes[1]) >= 19, "绘制与变换箭头应分行显示");
  await page.screenshot({ path: path.join(root, "animations.png") });
  saved = await save();
  clip = saved.clips.find((clip) => clip.id === id);
  assert.ok(clip.keyframes.some((frame) => frame.animation));
  assert.ok(
    clip.keyframes.some(
      (frame) => frame.animation && frame.value.scale === 1.5,
    ),
  );
  assert.equal(clip.drawing.strokes.length, 2);
  // Deselecting at the clip start shows the animated state; selection reveals all strokes.
  await page
    .locator(".ruler")
    .click({ position: { x: Number(start) * zoom, y: 12 } });
  await page.locator(".timeline-clip.text").click();
  await expect(paths).toHaveCount(0);
  await shape.click({ position: { x: 35, y: 8 } });
  await expect(paths).toHaveCount(5);
  await page
    .locator(".ruler")
    .click({ position: { x: Number(start) * zoom, y: 12 } });
  await page.getByTitle("播放 / 暂停（空格）", { exact: true }).click();
  await expect(paths).toHaveCount(1);
  await page.getByTitle("播放 / 暂停（空格）", { exact: true }).click();
  await expect(paths).toHaveCount(5);
  // Cancelled sessions do not add objects.
  await page.getByRole("button", { name: "涂鸦笔模式", exact: true }).click();
  await draw(0.4);
  await page
    .getByRole("button", { name: "取消绘制", exact: true })
    .first()
    .click();
  await expect(page.locator(".timeline-clip.shape")).toHaveCount(1);
  await save();
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, file);
  await page.getByRole("button", { name: "工程", exact: true }).click();
  await page.getByRole("button", { name: "打开工程", exact: true }).click();
  await expect(
    page.locator('.clip-animation[data-animation-kind="drawing"]'),
  ).toHaveCount(1);
  await page
    .locator(".drawing-animations .animation-arrow")
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "启用缓冲", exact: true }).click();
  await page
    .getByRole("menuitemradio", { name: "指数缓入/缓出", exact: true })
    .click();
  saved = await save();
  assert.equal(
    saved.clips.find((clip) => clip.id === id).drawing.easing,
    "exponential",
  );
  await page.keyboard.press("Delete");
  await expect(page.locator(".timeline-clip.shape")).toHaveCount(1);
  await expect(
    page.locator('.clip-animation[data-animation-kind="drawing"]'),
  ).toHaveCount(0);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(
    page.locator('.clip-animation[data-animation-kind="drawing"]'),
  ).toHaveCount(1);
  await page
    .locator(".tool-rail")
    .getByRole("button", { name: "标注", exact: true })
    .click();
  await page.getByRole("tab", { name: "草图运动", exact: true }).click();
  const beforeSketch = await time();
  await page.getByRole("button", { name: "手绘圆", exact: true }).click();
  assert.equal(await time(), beforeSketch, "内置手绘形状也不应移动播放头");
  await expect(
    page.locator('.clip-animation[data-animation-kind="drawing"]'),
  ).toHaveCount(2);
  await page.screenshot({ path: path.join(root, "hand-drawn-circle.png") });
  await page.getByRole("button", { name: "手绘矩形", exact: true }).click();
  await expect(annotationTab).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: path.join(root, "hand-drawn-rectangle.png") });
  await page.getByRole("button", { name: "勾选", exact: true }).click();
  await page.locator(".shape-presets").screenshot({ path: path.join(root, "sketch-presets.png") });
  await page.getByRole("tab", { name: "模糊和高亮", exact: true }).click();
  await page.getByRole("button", { name: "像素化", exact: true }).click();
  await expect(annotationTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("标注像素大小", { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(root, "annotation-inspector.png") });
  await frameTab.click();
  await expect(page.getByLabel("标注像素大小", { exact: true })).toBeHidden();
  assert.deepEqual(errors, []);
  console.log(
    `多笔绘制、混合笔刷、撤销/取消、播放头保持、完整编辑轨迹、绘制箭头拖动、叠加动画及保存重开通过：${root}`,
  );
} catch (error) {
  if (page)
    await page
      .screenshot({ path: path.join(root, "failure.png") })
      .catch(() => {});
  throw error;
} finally {
  await app.close();
}
