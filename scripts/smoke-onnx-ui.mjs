import assert from "node:assert/strict";
import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const kokoro = process.env.TRONCUT_TEST_KOKORO_DIR;
const sensevoice = process.env.TRONCUT_TEST_SENSEVOICE_DIR;
if (!kokoro || !sensevoice)
  throw new Error(
    "请设置 TRONCUT_TEST_KOKORO_DIR 与 TRONCUT_TEST_SENSEVOICE_DIR",
  );
const root = path.resolve("test-output/onnx-ui");
await fs.mkdir(root, { recursive: true });
const profile = path.resolve("test-output/onnx-integration/profile");
const modelCache = path.join(profile, "models/onnx");
await fs.mkdir(modelCache, { recursive: true });
if (path.resolve(kokoro) !== path.join(modelCache, "kokoro-multi-lang-v1_1"))
  await fs.cp(kokoro, path.join(modelCache, "kokoro-multi-lang-v1_1"), {
    recursive: true,
  });
await fs.cp(sensevoice, path.join(modelCache, "sensevoice-small"), {
  recursive: true,
});
for (const candidate of [
  path.join(sensevoice, "silero_vad.onnx"),
  path.join(sensevoice, "..", "silero-vad", "silero_vad.onnx"),
])
  try {
    await fs.copyFile(candidate, path.join(modelCache, "silero_vad.onnx"));
    break;
  } catch {
    /* Try the next common local model layout. */
  }
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
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page.getByLabel("工程名称", { exact: true }).fill("ONNX语音");
  await page.getByRole("button", { name: "旁白", exact: true }).click();
  await page.getByRole("button", { name: "旁白更多选项", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "AI 配音设置", exact: true })
    .click();
  await expect(page.getByLabel("配音模型", { exact: true })).toHaveValue(
    process.platform === "win32" ? "windows-sapi" : "kokoro-onnx",
  );
  const engines = await page
    .getByLabel("配音模型", { exact: true })
    .locator("option")
    .evaluateAll((items) => items.map((item) => item.value));
  assert.deepEqual(engines, [
    ...(process.platform === "win32" ? ["windows-sapi"] : []),
    "kokoro-onnx",
    "vits-onnx",
    "lux-onnx",
  ]);
  await page.getByLabel("配音模型", { exact: true }).selectOption("vits-onnx");
  await expect(page.getByLabel("配音模型目录", { exact: true })).toHaveCount(0);
  await page
    .getByLabel("配音模型", { exact: true })
    .selectOption("kokoro-onnx");
  await page.getByLabel("配音语速", { exact: true }).selectOption("1.25");
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await page
    .getByLabel("旁白文稿", { exact: true })
    .fill("欢迎使用本地语音模型。现在可以生成配音和字幕。");
  await page.getByRole("button", { name: "生成音频", exact: true }).click();
  await expect(page.locator(".narration-result")).toBeVisible({
    timeout: 90000,
  });
  await expect(page.locator(".timeline-clip.audio")).toHaveCount(1);
  await page.getByRole("button", { name: "试听音频", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "停止试听", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "媒体", exact: true }).click();
  await page.getByRole("button", { name: "旁白", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "试听音频", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "旁白更多选项", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "AI 配音设置", exact: true })
    .click();
  await expect(page.getByLabel("配音模型", { exact: true })).toHaveValue(
    "kokoro-onnx",
  );
  await expect(page.getByLabel("配音语速", { exact: true })).toHaveValue(
    "1.25",
  );
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await page.locator(".timeline-clip.audio").click();
  await page.getByRole("button", { name: "字幕", exact: true }).click();
  await page.getByRole("button", { name: "字幕操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "语音转文本", exact: true }).click();
  await page.getByLabel("识别模型", { exact: true }).selectOption("sensevoice");
  await page.getByRole("button", { name: "开始识别", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已生成", {
    timeout: 90000,
  });
  await expect(page.locator(".timeline-clip.text")).not.toHaveCount(0);
  const saveFolder = path.join(root, `run-${Date.now()}`);
  await fs.mkdir(saveFolder, { recursive: true });
  const file = path.join(saveFolder, "ONNX语音/ONNX语音.troncut");
  await app.evaluate(({ dialog }, destination) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [destination],
    });
  }, saveFolder);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("工程已保存", {
    timeout: 20000,
  });
  const project = JSON.parse(await fs.readFile(file, "utf8"));
  const narration = project.assets.find((asset) => asset.narration);
  assert.equal(narration.narration.engine, "kokoro-onnx");
  assert.equal(narration.narration.speed, 1.25);
  assert.ok(
    project.clips.some((clip) => clip.caption && /语音模型/.test(clip.text)),
  );
  await page.screenshot({ path: path.join(root, "captions.png") });
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(root, "result.json"),
    JSON.stringify({ projectFile: file, rendererErrors: errors }, null, 2),
  );
  console.log(
    "ONNX 桌面生成、试听停止、参数保留、自动模型缓存、字幕与工程保存通过",
  );
} finally {
  await app.close();
}
