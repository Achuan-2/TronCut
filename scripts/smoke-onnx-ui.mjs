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
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: path.resolve("test-output/onnx-integration/profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["."], env });
const errors = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page.getByLabel("工程名称", { exact: true }).fill("ONNX语音");
  await page.getByRole("button", { name: "配音", exact: true }).click();
  await expect(page.getByLabel("配音模型", { exact: true })).toHaveValue(
    "kokoro-onnx",
  );
  const engines = await page
    .getByLabel("配音模型", { exact: true })
    .locator("option")
    .evaluateAll((items) => items.map((item) => item.value));
  assert.deepEqual(engines, ["kokoro-onnx", "vits-onnx"]);
  await page.getByLabel("配音模型", { exact: true }).selectOption("vits-onnx");
  await page
    .getByLabel("配音模型目录", { exact: true })
    .fill("unused custom directory");
  await page.getByRole("button", { name: "下载配音模型", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("配音模型已就绪", {
    timeout: 90000,
  });
  await expect(page.getByLabel("配音模型目录", { exact: true })).toHaveValue(
    "",
  );
  await page
    .getByLabel("配音模型", { exact: true })
    .selectOption("kokoro-onnx");
  await page
    .getByLabel("配音文字", { exact: true })
    .fill("欢迎使用本地语音模型。现在可以生成配音和字幕。");
  await page.getByLabel("配音模型目录", { exact: true }).fill(kokoro);
  await page.getByLabel("配音语速", { exact: true }).selectOption("1.25");
  await page
    .getByRole("checkbox", { name: "仅使用已下载的依赖和模型", exact: true })
    .check();
  await page
    .getByRole("button", { name: "生成配音并加入时间线", exact: true })
    .click();
  await expect(page.locator(".narration-result")).toBeVisible({
    timeout: 90000,
  });
  await expect(page.locator(".timeline-clip.audio")).toHaveCount(1);
  await page.getByRole("button", { name: "试听配音", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "停止试听", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "媒体", exact: true }).click();
  await page.getByRole("button", { name: "配音", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "试听配音", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("配音模型目录", { exact: true })).toHaveValue(
    kokoro,
  );
  await page.locator(".timeline-clip.audio").click();
  await page.getByRole("button", { name: "字幕", exact: true }).click();
  await expect(page.getByLabel("识别引擎", { exact: true })).toHaveValue(
    "sensevoice",
  );
  await page.getByLabel("语言", { exact: true }).selectOption("yue");
  await page.getByLabel("识别引擎", { exact: true }).selectOption("paraformer");
  await expect(page.getByLabel("语言", { exact: true })).toHaveValue("auto");
  await page.getByLabel("识别引擎", { exact: true }).selectOption("sensevoice");
  await page.getByLabel("语言", { exact: true }).selectOption("zh");
  await page.getByLabel("识别模型目录", { exact: true }).fill(sensevoice);
  await page
    .getByRole("checkbox", { name: "仅使用已下载的依赖和模型", exact: true })
    .check();
  await page
    .getByRole("button", { name: "从选中片段生成字幕", exact: true })
    .click();
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
    "ONNX 桌面生成、试听停止、参数保留、语言切换、字幕与工程保存通过",
  );
} finally {
  await app.close();
}
