import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { setTimelineZoom } from "./timeline-zoom.mjs";

const root = path.resolve(`test-output/project-settings-ui/run-${Date.now()}`);
const profile = path.join(root, "profile"),
  documents = path.join(root, "Documents");
await fs.mkdir(profile, { recursive: true });
await fs.mkdir(documents, { recursive: true });
const helpers = path.join(root, "helpers.cjs");
await build({
  stdin: {
    contents:
      'export { createProject, newText } from "./shared/model"; export { probeMedia } from "./electron/media"; export { saveProject } from "./electron/project-store"; export { findBinary, runProcess } from "./electron/process";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  packages: "external",
  format: "cjs",
  outfile: helpers,
});
const {
  createProject,
  newText,
  probeMedia,
  saveProject,
  findBinary,
  runProcess,
} = createRequire(import.meta.url)(helpers);
const videoFile = path.join(root, "quiet-video.mp4"),
  audioFile = path.join(root, "loud-audio.wav");
await runProcess(findBinary("ffmpeg"), [
  "-y",
  "-f",
  "lavfi",
  "-i",
  "color=c=blue:s=320x180:r=20:d=3",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:sample_rate=48000:duration=3",
  "-af",
  "volume=0.1",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  videoFile,
]);
await runProcess(findBinary("ffmpeg"), [
  "-y",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=660:sample_rate=48000:duration=3",
  "-af",
  "volume=2",
  audioFile,
]);
const sources = await Promise.all(
  [videoFile, audioFile].map((file) => probeMedia(file)),
);
const sourceHash = createHash("sha256")
  .update(await fs.readFile(videoFile))
  .digest("hex");
const project = createProject("项目设置与自动响度");
project.assets = sources;
project.clips = sources.map((asset, index) => ({
  ...newText(index ? "audio" : "video", index * 3),
  id: index ? "audio" : "video",
  kind: asset.kind,
  assetId: asset.id,
  name: asset.name,
  duration: 3,
}));
// A second instance keeps the source cache active while the first opts out.
project.clips.push({ ...project.clips[0], id: "video-copy", start: 6 });
const file = path.join(root, "project", "fixture.troncut");
await saveProject(project, file);
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [".", file], env });
const page = await app.firstWindow();
page.setDefaultTimeout(20000);
await app.evaluate(({ app, BrowserWindow }, directory) => {
  app.setPath("documents", directory);
  BrowserWindow.getAllWindows()[0].setSize(1440, 1000);
}, documents);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const clip = (id) => page.locator(`.timeline-clip[data-clip-id="${id}"]`);
const settingsButton = page.getByRole("button", {
  name: "项目设置",
  exact: true,
});
const dialog = page.getByRole("dialog", { name: "项目设置", exact: true });
const clipCheckbox = page
  .locator(".inspector")
  .getByRole("checkbox", { name: "自动标准化响度", exact: true });
const undo = () => page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
const redo = () =>
  page.getByTitle("重做 Ctrl+Shift+Z", { exact: true }).click();
const save = async () => {
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".busy-overlay")).toHaveCount(0);
  await expect(page.locator(".project-save-state")).not.toContainText("*");
  return JSON.parse(await fs.readFile(file, "utf8"));
};
try {
  await expect(clip("audio")).toBeVisible();
  await setTimelineZoom(page, 100);
  await clip("audio").click();
  await expect(clipCheckbox).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "画布大小设置", exact: true }),
  ).toHaveCount(0);
  await settingsButton.click();
  await dialog
    .getByRole("checkbox", { name: "自动标准化响度", exact: true })
    .check();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(clipCheckbox).toBeDisabled();
  await page
    .getByRole("combobox", { name: "画布显示比例", exact: true })
    .selectOption("settings");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("宽度（像素）", { exact: true }).fill("0");
  await dialog.getByRole("button", { name: "应用", exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("预设尺寸", { exact: true }).selectOption("3");
  await dialog.getByLabel("帧率", { exact: true }).fill("24");
  await dialog
    .getByRole("checkbox", { name: "自动标准化响度", exact: true })
    .check();
  await page.screenshot({ path: path.join(root, "project-settings.png") });
  await dialog.getByRole("button", { name: "应用", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(settingsButton).toContainText("1280 × 720");
  await expect(clipCheckbox).toBeEnabled();
  await expect(page.locator(".play-button")).toBeEnabled();
  await page.getByRole("slider", { name: "播放进度", exact: true }).fill("1");
  const video = page.locator(".preview-layer.video video"),
    audio = page.locator(".preview-layer.video audio");
  await expect(audio).toHaveAttribute("src", /loudness-/);
  await expect
    .poll(() => video.evaluate((element) => element.muted))
    .toBe(true);
  await expect
    .poll(() => audio.evaluate((element) => element.readyState))
    .toBeGreaterThanOrEqual(2);
  await page.locator(".play-button").click();
  await expect
    .poll(() => audio.evaluate((element) => element.currentTime))
    .toBeGreaterThan(1.1);
  await page.locator(".play-button").click();
  await expect
    .poll(() => audio.evaluate((element) => element.paused))
    .toBe(true);
  await clip("video").click();
  await page.getByRole("tab", { name: "声音", exact: true }).click();
  await clipCheckbox.uncheck();
  await expect(page.locator(".preview-layer.video audio")).toHaveCount(0);
  await expect
    .poll(() => video.evaluate((element) => element.muted))
    .toBe(false);
  await clip("audio").click({ modifiers: ["Control"] });
  await expect(clipCheckbox).toHaveAttribute("aria-checked", "mixed");
  expect(await clipCheckbox.evaluate((element) => element.indeterminate)).toBe(
    true,
  );
  await page.screenshot({ path: path.join(root, "mixed-loudness.png") });
  await clipCheckbox.check();
  await expect(clipCheckbox).toBeChecked();
  await undo();
  await expect(clipCheckbox).toHaveAttribute("aria-checked", "mixed");
  await redo();
  await expect(clipCheckbox).toBeChecked();
  await settingsButton.click();
  await dialog
    .getByRole("checkbox", { name: "自动标准化响度", exact: true })
    .uncheck();
  await dialog.getByRole("button", { name: "应用", exact: true }).click();
  await expect(clipCheckbox).toBeDisabled();
  await undo();
  await expect(clipCheckbox).toBeEnabled();
  const saved = await save();
  expect(saved.audio.autoNormalizeLoudness).toBe(true);
  expect(saved.canvas).toMatchObject({ width: 1280, height: 720, fps: 24 });
  expect(saved.assets).toHaveLength(2);
  expect(
    saved.clips.every((clip) => clip.autoNormalizeLoudness !== false),
  ).toBe(true);
  expect(
    createHash("sha256")
      .update(await fs.readFile(videoFile))
      .digest("hex"),
  ).toBe(sourceHash);
  await page.reload();
  await page.getByRole("button", { name: project.name, exact: false }).click();
  await expect(settingsButton).toContainText("1280 × 720");
  await settingsButton.click();
  await expect(
    dialog.getByRole("checkbox", { name: "自动标准化响度", exact: true }),
  ).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(page.locator(".play-button")).toBeEnabled();
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      root,
      checks:
        "项目设置入口、校验和取消、项目与素材开关、多选混合态、静音原视频并同步标准化音频、撤销重做、保存重开及原件保留",
      errors,
    }),
  );
} catch (error) {
  await page
    .screenshot({ path: path.join(root, "failure.png") })
    .catch(() => {});
  console.error(root);
  throw error;
} finally {
  await app.close();
}
