import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const root = path.resolve("test-output/export-dialog-ui", `run-${Date.now()}`);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
const source = path.join(root, "source.png");
await sharp(
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#335d75"/><circle cx="160" cy="90" r="55" fill="#76e5b5"/></svg>',
  ),
)
  .png()
  .toFile(source);
const project = {
  format: "troncut",
  version: 1,
  id: "export-ui",
  name: "导出设置验收",
  canvas: { width: 320, height: 180, fps: 10, background: "#101319" },
  markers: [],
  tracks: [
    { id: "video", name: "轨道1", hidden: false, locked: false, muted: false },
  ],
  assets: [
    {
      id: "source",
      name: "source.png",
      path: source,
      kind: "image",
      duration: 5,
      width: 320,
      height: 180,
      hasAudio: false,
    },
  ],
  clips: [
    {
      id: "clip",
      trackId: "video",
      assetId: "source",
      kind: "image",
      name: "source",
      start: 0,
      duration: 0.4,
      sourceIn: 0,
      speed: 1,
      volume: 1,
      podcast: false,
      transform: { x: 0.5, y: 0.5, scale: 1, opacity: 1 },
      keyframes: [],
    },
  ],
  exportSettings: { encoder: "software" },
};
await fs.writeFile(
  path.join(profile, "recovery.json"),
  JSON.stringify({ project, file: null }),
);
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["."], env });
const errors = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => {
      throw new Error("导出不应再调用系统保存对话框");
    };
  });
  await page.getByRole("button", { name: "恢复编辑", exact: true }).click();
  const open = async () => {
    await page.getByRole("button", { name: "导出视频", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "导出视频", exact: true }),
    ).toBeVisible();
  };
  await open();
  const videos = await app.evaluate(({ app }) => app.getPath("videos"));
  await expect(page.getByLabel("导出位置", { exact: true })).toHaveValue(
    videos,
  );
  await page.getByLabel("导出质量", { exact: true }).selectOption("compact");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    (await fs.readdir(root)).filter((name) => /\.(mp4|webm)$/.test(name)),
  ).toEqual([]);
  await app.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [root],
    });
  }, root);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("工程已保存", {
    timeout: 20000,
  });
  const projectDirectory = path.join(root, project.name);
  await open();
  await expect(page.getByLabel("导出位置", { exact: true })).toHaveValue(
    projectDirectory,
  );
  await expect(page.getByLabel("导出质量", { exact: true })).toHaveValue(
    "high",
  );
  const outputDirectory = path.join(root, "视频输出");
  await app.evaluate(({ dialog }, outputDirectory) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [outputDirectory],
    });
  }, outputDirectory);
  await page.getByRole("button", { name: "浏览…", exact: true }).click();
  await expect(page.getByLabel("导出位置", { exact: true })).toHaveValue(
    outputDirectory,
  );
  await page.getByLabel("导出文件名", { exact: true }).fill("成片");
  await page.getByLabel("导出分辨率", { exact: true }).selectOption("480p");
  await page.getByLabel("导出质量", { exact: true }).selectOption("standard");
  await page.screenshot({ path: path.join(root, "export-dialog.png") });
  await page.getByRole("button", { name: "开始导出", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("视频已导出", {
    timeout: 30000,
  });
  const mp4 = path.join(outputDirectory, "成片.mp4");
  const original = await fs.readFile(mp4);
  expect(original.length).toBeGreaterThan(1000);
  await open();
  await expect(page.getByLabel("导出位置", { exact: true })).toHaveValue(
    projectDirectory,
  );
  await expect(page.getByLabel("导出分辨率", { exact: true })).toHaveValue(
    "480p",
  );
  await expect(page.getByLabel("导出质量", { exact: true })).toHaveValue(
    "standard",
  );
  await page.getByLabel("导出位置", { exact: true }).fill(outputDirectory);
  await page.getByLabel("导出文件名", { exact: true }).fill("成片");
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({
      response: 0,
      checkboxChecked: false,
    });
  });
  await page.getByRole("button", { name: "开始导出", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "开始导出", exact: true }),
  ).toBeEnabled();
  expect(await fs.readFile(mp4)).toEqual(original);
  await page.getByLabel("导出位置", { exact: true }).fill("relative-path");
  await page.getByRole("button", { name: "开始导出", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("完整文件夹路径");
  await page.getByLabel("导出位置", { exact: true }).fill(outputDirectory);
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({
      response: 1,
      checkboxChecked: false,
    });
  });
  await page.getByLabel("导出质量", { exact: true }).selectOption("compact");
  await page.getByRole("button", { name: "开始导出", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30000 });
  await open();
  await page.getByLabel("导出位置", { exact: true }).fill(outputDirectory);
  await page.getByLabel("导出文件名", { exact: true }).fill("网页成片.mp4");
  await page.getByLabel("导出格式", { exact: true }).selectOption("webm");
  await expect(page.getByLabel("导出摘要", { exact: true })).toContainText(
    "网页成片.webm",
  );
  await page.getByRole("button", { name: "开始导出", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30000 });
  const { stdout } = await promisify(execFile)(
    path.resolve(
      "resources/bin",
      process.platform === "win32" ? "ffprobe.exe" : "ffprobe",
    ),
    [
      "-v",
      "error",
      "-show_streams",
      "-of",
      "json",
      path.join(outputDirectory, "网页成片.webm"),
    ],
    { windowsHide: true },
  );
  const info = JSON.parse(stdout);
  expect(info.streams.find((s) => s.codec_type === "video")).toMatchObject({
    codec_name: "vp9",
    width: 854,
    height: 480,
  });
  expect(info.streams.find((s) => s.codec_type === "audio").codec_name).toBe(
    "opus",
  );
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("工程已保存", {
    timeout: 20000,
  });
  const saved = JSON.parse(
    await fs.readFile(
      path.join(projectDirectory, `${project.name}.troncut`),
      "utf8",
    ),
  );
  expect(saved.canvas).toEqual(project.canvas);
  expect(saved.exportSettings).toMatchObject({
    format: "webm",
    resolution: "480p",
    quality: "compact",
  });
  expect(errors).toEqual([]);
  console.log(
    `导出弹窗、项目目录默认值、浏览目录、取消与覆盖、失败重试、真实 MP4/WebM 和设置保存通过：${root}`,
  );
} catch (error) {
  await app
    .windows()[0]
    ?.screenshot({ path: path.join(root, "failure.png") })
    .catch(() => {});
  console.error(`失败截图：${root}`);
  throw error;
} finally {
  await app.close();
}
