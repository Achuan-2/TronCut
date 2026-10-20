import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { timelineZoom } from "./timeline-zoom.mjs";

const root = path.resolve("test-output/sketch-drop-ui", `run-${Date.now()}`);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
const bundle = await build({
  stdin: {
    contents: 'export { createProject, newText } from "./shared/model"; export { sketchPresets, annotationMime } from "./shared/annotations"; export { annotationSvgBody, drawingProgress } from "./shared/annotation-style";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { createProject, newText, sketchPresets, annotationMime, annotationSvgBody, drawingProgress } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const project = createProject("草图添加完成帧");
project.clips = [{ ...newText("video", 0, 0, "参考背景"), duration: 20 }];
const file = path.join(root, "fixture.troncut");
await fs.writeFile(file, JSON.stringify(project));
await fs.writeFile(path.join(profile, "preferences.json"), JSON.stringify({
  timing: { annotation: 0.5 },
}));
const env = { ...process.env, FRAMECRAFT_SMOKE: "1", FRAMECRAFT_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [".", file], env });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.locator(".timeline-clip")).toHaveCount(1);
  await page.locator(".tool-rail").getByRole("button", { name: "标注", exact: true }).click();
  await page.getByRole("tab", { name: "草图运动", exact: true }).click();
  const canvas = page.locator(".canvas-holder .canvas");
  const progress = page.getByLabel("播放进度", { exact: true });
  const reset = async () => {
    await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
    await expect(page.locator(".timeline-clip")).toHaveCount(1);
    await progress.fill("2");
  };
  const savedClip = async () => {
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.locator(".toast")).toContainText("项目已保存");
    const saved = JSON.parse(await fs.readFile(file, "utf8"));
    return saved.clips.find((clip) => clip.id !== project.clips[0].id);
  };
  const checkCompleted = async (start) => {
    const clip = await savedClip();
    const time = Number(await progress.inputValue());
    const end = clip.start + clip.drawing.delay + clip.drawing.duration;
    expect(clip.start).toBeCloseTo(start, 6);
    expect(time).toBeCloseTo(Math.ceil(end * project.canvas.fps - 1e-7) / project.canvas.fps, 6);
    expect(time).toBeLessThan(clip.start + clip.duration);
    expect(drawingProgress(clip, time - clip.start)).toBe(1);
    const layer = page.locator(`.preview-layer[data-clip-id="${clip.id}"]`);
    await expect(layer).toBeVisible();
    const body = await layer.evaluate((node, markup) => {
      const expected = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      expected.innerHTML = markup;
      return {
        actual: node.querySelector("svg[viewBox]").innerHTML,
        expected: expected.innerHTML,
      };
    }, annotationSvgBody(clip, 1));
    expect(body.actual).toBe(body.expected);
  };
  for (const preset of sketchPresets) {
    await progress.fill("2");
    await page.getByRole("button", { name: preset.name, exact: true }).dragTo(canvas);
    await checkCompleted(2);
    await reset();
  }
  // Clicking a preset uses the same insertion path as dragging it.
  await page.getByRole("button", { name: "勾选", exact: true }).click();
  await checkCompleted(2);
  await reset();

  const zoom = await timelineZoom(page);
  await page.getByRole("button", { name: "草图直线", exact: true }).dragTo(
    page.locator('.track-lane[data-track="titles"]'),
    { targetPosition: { x: 6 * zoom, y: 30 } },
  );
  await checkCompleted(6);
  await reset();

  // A delayed, non-frame-aligned drawing must also show its full final frame.
  const transfer = await page.evaluateHandle(({ mime, template }) => {
    const data = new DataTransfer();
    data.setData(mime, JSON.stringify(template));
    return data;
  }, {
    mime: annotationMime,
    template: {
      ...sketchPresets[0].template,
      drawing: { enabled: true, delay: 0.25, duration: 1.17 },
    },
  });
  await canvas.dispatchEvent("drop", { dataTransfer: transfer });
  await checkCompleted(2);
  await page.locator(".preview-panel").screenshot({ path: path.join(root, "completed-sketch.png") });
  await reset();

  await page.getByRole("tab", { name: "形状标注", exact: true }).click();
  await page.getByRole("button", { name: "五角星", exact: true }).dragTo(canvas);
  await expect(progress).toHaveValue("2");
  await reset();

  await page.getByRole("tab", { name: "涂鸦笔", exact: true }).click();
  await page.getByRole("button", { name: "启用涂鸦笔", exact: true }).click();
  const overlay = page.getByLabel("涂鸦绘制画布", { exact: true });
  const box = await overlay.boundingBox();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6, { steps: 10 });
  await page.mouse.up();
  await page.locator(".canvas-drawing-actions").getByRole("button", { name: "完成绘制", exact: true }).click();
  await expect(progress).toHaveValue("2");
  expect(errors).toEqual([]);
  console.log(`10 个草图拖入、点击、时间轴落点、延迟/非整帧结束定位及完整笔迹、普通形状/手动涂鸦定位通过：${root}`);
} catch (error) {
  await (await app.firstWindow()).screenshot({ path: path.join(root, "failure.png") }).catch(() => { });
  throw error;
} finally {
  await app.close();
}
