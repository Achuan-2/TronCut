import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(`test-output/windows-speech-ui/run-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
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
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page.getByLabel("工程名称", { exact: true }).fill("Windows语音");
  await page.getByRole("button", { name: "旁白", exact: true }).click();
  await page.getByText("AI 配音设置", { exact: true }).click();
  await expect(page.getByLabel("配音模型", { exact: true })).toHaveValue(
    "windows-sapi",
  );
  await expect(
    page.getByRole("button", { name: "刷新系统音色", exact: true }),
  ).toBeEnabled({ timeout: 20000 });
  await expect(page.getByLabel("配音模型目录", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "下载配音模型", exact: true }),
  ).toHaveCount(0);
  const choices = await page
    .getByLabel("配音音色", { exact: true })
    .locator("option")
    .evaluateAll((items) =>
      items.map((item) => ({ id: item.value, text: item.textContent })),
    );
  const voice = choices.find((choice) => /Microsoft Yunxi/.test(choice.text));
  assert.ok(voice, "本机验证应能发现已安装的云希");
  assert.ok(!choices.some((choice) => /Online/.test(choice.text)));
  await page.getByLabel("配音音色", { exact: true }).selectOption(voice.id);
  await page.getByLabel("配音语速", { exact: true }).selectOption("1.25");
  await page
    .getByLabel("旁白文稿", { exact: true })
    .fill("这是通过 Windows 系统语音生成的中文男声。");
  await page.getByRole("button", { name: "生成音频", exact: true }).click();
  await expect(page.locator(".narration-result")).toBeVisible({
    timeout: 45000,
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
  await page.getByLabel("配音模型", { exact: true }).selectOption("vits-onnx");
  await page.locator(".timeline-clip.audio").click();
  await page.getByRole("button", { name: "读取配音参数", exact: true }).click();
  await expect(page.getByLabel("配音模型", { exact: true })).toHaveValue(
    "windows-sapi",
  );
  await expect(page.getByLabel("配音音色", { exact: true })).toHaveValue(
    voice.id,
  );
  await expect(page.getByLabel("配音语速", { exact: true })).toHaveValue(
    "1.25",
  );
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [folder],
    });
  }, root);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("工程已保存", {
    timeout: 20000,
  });
  const file = path.join(root, "Windows语音/Windows语音.troncut");
  const saved = JSON.parse(await fs.readFile(file, "utf8"));
  assert.equal(saved.assets[0].narration.engine, "windows-sapi");
  assert.equal(saved.assets[0].narration.voice, voice.id);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(root, "windows-speech.png") });
  await fs.writeFile(
    path.join(root, "result.json"),
    JSON.stringify({ file, voice, rendererErrors: errors }, null, 2),
  );
  console.log(`WINDOWS_SPEECH_UI_OK ${root}`);
} finally {
  await app.close();
}
