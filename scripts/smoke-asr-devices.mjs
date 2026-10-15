import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(`test-output/asr-devices-ui/${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const env = {
  ...process.env,
  FRAMECRAFT_USER_DATA: path.join(root, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["."], env });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page.getByRole("button", { name: "字幕", exact: true }).click();
  await page.getByRole("button", { name: "字幕操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "语音转文本", exact: true }).click();
  const device = page.getByLabel("识别设备");
  await expect(device).toHaveValue("cpu");
  await device.selectOption("cuda");
  await expect(device).toHaveValue("cuda");
  await expect(
    page.getByText(
      "需要 NVIDIA 显卡；首次使用会自动下载 GPU 环境与模型，准备时间较长。",
    ),
  ).toBeVisible();
  await page.screenshot({ path: path.join(root, "qwen-cuda.png") });
  await page.getByLabel("识别模型").selectOption("sensevoice");
  await expect(device).toHaveValue("cpu");
  await expect(device.locator('option[value="cuda"]')).toHaveAttribute(
    "disabled",
    "",
  );
  await page.getByLabel("识别模型").selectOption("qwen3-asr");
  await expect(device.locator('option[value="cuda"]')).not.toHaveAttribute(
    "disabled",
  );
  await device.selectOption("cuda");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "字幕操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "语音转文本", exact: true }).click();
  await expect(device).toHaveValue("cuda");
  expect(errors).toEqual([]);
  console.log("字幕设备选择、GPU 提示、模型切换与会话内设备保留通过", root);
} finally {
  await app.close();
}
