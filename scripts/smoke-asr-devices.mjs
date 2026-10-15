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
  await expect(page.getByLabel("识别模型")).toHaveValue("qwen3-asr");
  await expect(page.getByLabel("识别设备")).toHaveCount(0);
  await expect(
    page.getByText("GPU · NVIDIA CUDA", { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: path.join(root, "qwen-cpu.png") });
  await page.getByLabel("识别模型").selectOption("sensevoice");
  await expect(page.getByLabel("识别设备")).toHaveCount(0);
  await page.getByLabel("识别模型").selectOption("qwen3-asr");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "字幕操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "语音转文本", exact: true }).click();
  await expect(page.getByLabel("识别模型")).toHaveValue("qwen3-asr");
  await expect(page.getByLabel("识别设备")).toHaveCount(0);
  expect(errors).toEqual([]);
  console.log("字幕 CPU 模型选择、CUDA 入口移除与弹窗重开通过", root);
} finally {
  await app.close();
}
