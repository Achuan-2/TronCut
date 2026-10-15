import { _electron as electron, expect } from "@playwright/test";
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
    path: video,
    name: "测试视频",
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
  await expect(page.getByLabel("画布取景预览")).toBeVisible();
  const zoom = Number(await page.getByLabel("时间线缩放").inputValue());
  await page.locator(".ruler").click({ position: { x: 2 * zoom, y: 12 } });
  await page.getByLabel("画布缩放百分比", { exact: true }).fill("200");
  await expect(page.locator(".timeline-clip .clip-animation")).toHaveCount(1);
  await page.screenshot({ path: path.join(root, "zoom-pan.png") });
  await zoomTab.focus();
  await page.keyboard.press("End");
  await expect(presetsTab).toBeFocused();
  await expect(presetsTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".animation-presets button")).toHaveCount(3);
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
  // Add a preset later in the clip, preserving the existing zoom keyframes.
  await page.locator(".ruler").click({ position: { x: 4 * zoom, y: 12 } });
  await page.getByRole("button", { name: /轻柔淡入/ }).click();
  await expect(page.locator(".timeline-clip .clip-animation")).toHaveCount(2);
  await page.screenshot({ path: path.join(root, "presets.png") });
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("工程已保存");
  const saved = JSON.parse(await fs.readFile(file, "utf8"));
  assert.ok(
    saved.clips[0].keyframes.some((frame) => frame.zoomPan?.scale === 2),
  );
  assert.ok(
    saved.clips[0].keyframes.some((frame) => frame.value.opacity === 0),
  );
  assert.deepEqual(errors, []);
  console.log(`动画子 Tab、键盘切换、状态保留及两类动画保存通过：${root}`);
} finally {
  await app.close();
}
