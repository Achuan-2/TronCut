import { _electron as electron, expect } from "@playwright/test";
import { timelineZoom } from "./timeline-zoom.mjs";
import { build } from "esbuild";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(`test-output/animation-tabs/run-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const video = path.join(root, "source.mp4");
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
    "6",
    "-pix_fmt",
    "yuv420p",
    video,
  ],
  { windowsHide: true },
);
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
const project = createProject("动画分类测试");
project.assets = [
  {
    id: "video",
    path: path.basename(video),
    name: "测试视频.mp4",
    kind: "video",
    duration: 6,
    width: 320,
    height: 180,
    hasAudio: false,
  },
];
project.clips = [
  {
    ...newText(project.tracks[0].id, 0),
    kind: "video",
    assetId: "video",
    text: undefined,
    style: undefined,
    duration: 6,
  },
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
  page.on("pageerror", (error) => errors.push(error.message));
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, file);
  await page.getByRole("button", { name: "打开项目", exact: true }).click();
  await page.locator(".timeline-clip.video").click();
  const rail = page.locator(".tool-rail");
  await expect(
    rail.getByRole("button", { name: "缩放与平移", exact: true }),
  ).toHaveCount(0);
  await rail.getByRole("button", { name: "动画", exact: true }).click();
  const zoomTab = page.getByRole("tab", { name: "缩放与平移", exact: true });
  const presetsTab = page.getByRole("tab", { name: "动画", exact: true });
  await expect(zoomTab).toHaveAttribute("aria-selected", "true");
  const autoAnimate = page.getByRole("checkbox", {
    name: "开启自动动画",
    exact: true,
  });
  await expect(autoAnimate).toBeVisible();
  await expect(autoAnimate).toHaveAttribute("title", /自动记录位置/);
  await autoAnimate.check();
  await expect(autoAnimate).toBeChecked();
  await autoAnimate.uncheck();
  await expect(page.getByLabel("画布取景预览")).toBeVisible();
  const zoom = await timelineZoom(page);
  await page.locator(".ruler").click({ position: { x: 2 * zoom, y: 29 } });
  await page.getByLabel("画布缩放百分比", { exact: true }).fill("200");
  await expect(page.locator(".timeline-clip .clip-animation")).toHaveCount(1);
  await page.screenshot({ path: path.join(root, "zoom-pan.png") });
  await zoomTab.focus();
  await page.keyboard.press("End");
  await expect(presetsTab).toBeFocused();
  await expect(presetsTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".animation-presets .animation-card")).toHaveCount(
    1,
  );
  await expect(
    page.getByRole("button", { name: "添加动画", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "添加关键帧", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("画布取景预览")).toHaveCount(0);
  await page.keyboard.press("Home");
  await expect(zoomTab).toBeFocused();
  await expect(page.getByLabel("画布缩放百分比", { exact: true })).toHaveValue(
    "200",
  );
  await presetsTab.click();
  await rail.getByRole("button", { name: "媒体", exact: true }).click();
  await rail.getByRole("button", { name: "动画", exact: true }).click();
  await expect(presetsTab).toHaveAttribute("aria-selected", "true");
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
  const card = page.locator('.animation-card[data-animation="custom"]');
  const timelineClip = page.locator(".timeline-clip.video");
  const layer = page.locator(".canvas-holder .preview-layer.video");
  const arrows = timelineClip.locator(".clip-animation");
  const startDrag = async (target, offset) => {
    const from = await card.boundingBox();
    const to = await target.boundingBox();
    const x = to.x + (offset?.x ?? to.width / 2);
    const y = to.y + (offset?.y ?? to.height / 2);
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      from.x + from.width / 2 + 10,
      from.y + from.height / 2,
      { steps: 3 },
    );
    await page.mouse.move(x, y, { steps: 15 });
    await page.mouse.move(x + 0.1, y);
  };
  // A click behaves exactly like Add Animation and keeps earlier zoom frames.
  await page.locator(".ruler").click({ position: { x: 4 * zoom, y: 29 } });
  await card.click();
  await expect(arrows).toHaveCount(2);
  await page.screenshot({ path: path.join(root, "presets.png") });
  let saved = await save();
  assert.ok(
    saved.clips[0].keyframes.some((frame) => frame.zoomPan?.scale === 2),
  );
  assert(
    saved.clips[0].keyframes.some(
      (frame) => frame.animation && frame.time === 4,
    ),
  );
  await undo();
  await page.getByRole("button", { name: "添加动画", exact: true }).click();
  await expect(arrows).toHaveCount(2);
  const buttonAnimation = (await save()).clips[0].keyframes;
  assert.deepEqual(buttonAnimation, saved.clips[0].keyframes);

  // Timeline hover previews the drop interval, independent of the playhead.
  await page.locator(".ruler").click({ position: { x: zoom, y: 29 } });
  await startDrag(timelineClip, { x: 5.5 * zoom, y: 12 });
  const ghost = page.locator(".animation-drop-preview");
  await expect(ghost).toHaveAttribute("data-end", "5.5");
  await page.screenshot({ path: path.join(root, "timeline-hover.png") });
  await page.mouse.up();
  await expect(ghost).toHaveCount(0);
  await expect(arrows).toHaveCount(3);
  saved = await save();
  assert(
    saved.clips[0].keyframes.some(
      (frame) => frame.animation && frame.time === 5.5,
    ),
  );
  await undo();
  await expect(arrows).toHaveCount(2);

  // Canvas drag hits the visible object and adds at the current playhead.
  await page.locator(".ruler").click({ position: { x: 5.5 * zoom, y: 29 } });
  await startDrag(layer);
  await expect(layer).toHaveClass(/effect-drop-target/);
  await page.screenshot({ path: path.join(root, "canvas-hover.png") });
  await page.mouse.up();
  await expect(layer).not.toHaveClass(/effect-drop-target/);
  await expect(arrows).toHaveCount(3);
  saved = await save();
  assert(
    saved.clips[0].keyframes.some(
      (frame) => frame.animation && frame.time === 5.5,
    ),
  );
  // The inserted endpoint remains editable through the inspector.
  await page.getByLabel("缩放 (%)", { exact: true }).fill("150");
  saved = await save();
  assert.equal(
    saved.clips[0].keyframes.find(
      (frame) => frame.animation && frame.time === 5.5,
    ).value.scale,
    1.5,
  );

  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.setData("troncut-animation", "custom");
    return data;
  });
  // Locked tracks reject the drop without adding frames.
  await page
    .locator(`.track-header[data-track-id="${project.clips[0].trackId}"]`)
    .getByTitle("锁定 / 解锁轨道", { exact: true })
    .click();
  await layer.dispatchEvent("dragover", { dataTransfer: transfer });
  await expect(layer).not.toHaveClass(/effect-drop-target/);
  await layer.dispatchEvent("drop", { dataTransfer: transfer });
  await expect(arrows).toHaveCount(3);
  // Saved animations survive reopening the project.
  await save();
  await page.getByRole("button", { name: "项目", exact: true }).click();
  await page.getByRole("button", { name: "导入项目", exact: true }).click();
  await expect(page.getByLabel("播放进度", { exact: true })).toHaveValue("0");
  await expect(arrows).toHaveCount(3);
  assert.deepEqual(errors, []);
  console.log(
    `自定义动画、按钮一致性、原生时间轴与画布拖放、端点编辑、锁定、撤销及保存重开通过：${root}`,
  );
} finally {
  await app.close();
}
