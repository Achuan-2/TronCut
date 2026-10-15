import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { _electron as electron, expect } from "@playwright/test";

const input = process.env.TRONCUT_LUX_TEST_AUDIO;
const profile = process.env.TRONCUT_LUX_TEST_USER_DATA;
if (!input || !profile)
  throw new Error(
    "请设置 TRONCUT_LUX_TEST_AUDIO 与 TRONCUT_LUX_TEST_USER_DATA（已有模型与环境的测试缓存）",
  );
const root = path.resolve(`test-output/lux-tts-ui/${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: path.resolve(profile),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: [
    ".",
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    `--use-file-for-fake-audio-capture=${path.resolve(input)}`,
  ],
  env,
});
const page = await app.firstWindow();
page.setDefaultTimeout(30000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
let voice;
try {
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page.getByRole("button", { name: "旁白", exact: true }).click();
  const settings = async () => {
    await page
      .getByRole("button", { name: "旁白更多选项", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "AI 配音设置", exact: true })
      .click();
  };
  await settings();
  await page.getByLabel("配音模型", { exact: true }).selectOption("lux-onnx");
  await expect(
    page.getByRole("button", { name: "导入参考音频文件", exact: true }),
  ).toBeVisible();
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, path.resolve(input));
  await page
    .getByRole("button", { name: "导入参考音频文件", exact: true })
    .click();
  await expect(page.getByLabel("试听克隆参考音频")).toHaveAttribute(
    "src",
    /^framecraft-media:/,
  );
  await page
    .getByRole("button", { name: "自动识别参考文字", exact: true })
    .click();
  await expect(page.getByLabel("参考音频文字")).not.toHaveValue("", {
    timeout: 120000,
  });
  await page.getByLabel("音色名称", { exact: true }).fill("界面验证 · LuxTTS");
  await page
    .getByLabel("参考音频文字")
    .fill("欢迎使用本地语音模型。现在可以保存音色，生成自己的旁白。");
  await page.screenshot({ path: path.join(root, "imported-reference.png") });
  await page
    .getByRole("button", { name: "克隆并保存音色", exact: true })
    .click();
  await expect(page.getByLabel("配音音色", { exact: true })).not.toHaveValue(
    "",
    { timeout: 120000 },
  );
  voice = await page.getByLabel("配音音色", { exact: true }).inputValue();
  await expect(
    page.getByLabel("配音音色", { exact: true }).locator("option:checked"),
  ).toHaveText("界面验证 · LuxTTS");
  await page.getByRole("button", { name: "试听音色", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "停止试听音色", exact: true }),
  ).toBeVisible({ timeout: 120000 });
  await page.getByRole("button", { name: "停止试听音色", exact: true }).click();
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await settings();
  await expect(page.getByLabel("配音音色", { exact: true })).toHaveValue(voice);
  await page.getByRole("button", { name: "创建克隆音色", exact: true }).click();
  const beforeClips = await page.locator(".timeline-clip").count();
  await page
    .getByRole("button", { name: "直接录制参考声音", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /停止参考录音/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /停止参考录音 · 3\./ }),
  ).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: /停止参考录音/ }).click();
  await expect(page.getByText(/参考声音：voice-reference-/)).toBeVisible();
  assert.equal(
    await page.locator(".timeline-clip").count(),
    beforeClips,
    "参考录音不加入时间线",
  );
  await expect(page.getByLabel("配音模型", { exact: true })).toBeEnabled();
  await page.getByLabel("音色名称", { exact: true }).fill("录音验证 · LuxTTS");
  await page.getByLabel("参考音频文字").fill("欢迎使用本地语音模型。");
  await page
    .getByRole("button", { name: "克隆并保存音色", exact: true })
    .click();
  await expect(page.getByLabel("配音音色", { exact: true })).not.toHaveValue(
    voice,
    { timeout: 120000 },
  );
  const recordedVoice = await page
    .getByLabel("配音音色", { exact: true })
    .inputValue();
  await page.screenshot({ path: path.join(root, "saved-voices.png") });
  await page.getByRole("button", { name: "删除音色", exact: true }).click();
  await page.getByRole("button", { name: "确认删除音色", exact: true }).click();
  await expect(
    page
      .getByLabel("配音音色", { exact: true })
      .locator(`option[value="${recordedVoice}"]`),
  ).toHaveCount(0);
  await page.getByLabel("配音音色", { exact: true }).selectOption(voice);
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await page
    .getByLabel("旁白文稿")
    .fill("你好，这是界面中保存音色后的克隆配音。");
  await page.getByRole("button", { name: "生成音频", exact: true }).click();
  await expect(page.locator(".narration-result")).toBeVisible({
    timeout: 120000,
  });
  await settings();
  await page.getByRole("button", { name: "删除音色", exact: true }).click();
  await page.getByRole("button", { name: "确认删除音色", exact: true }).click();
  await expect(
    page
      .getByLabel("配音音色", { exact: true })
      .locator(`option[value="${voice}"]`),
  ).toHaveCount(0);
  voice = undefined;
  assert.deepEqual(errors, []);
  console.log(
    "LuxTTS 文件导入、参考文字识别、录音、保存音色、试听、正式配音与删除通过：",
    root,
  );
} finally {
  if (voice)
    await page
      .evaluate((id) => window.framecraft.deleteClonedVoice(id), voice)
      .catch(() => {});
  await page.evaluate(() => window.framecraft.markDirty(false)).catch(() => {});
  await app.close();
}
