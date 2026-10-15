import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";

const root = path.resolve(`test-output/ai-captions-ui/run-${Date.now()}`);
const profile = path.join(root, "profile");
await fs.mkdir(root, { recursive: true });
const requests = [];
let rejectRequests = false;
const server = http.createServer(async (request, response) => {
  try {
    let body = "";
    for await (const chunk of request) body += chunk;
    const data = JSON.parse(body);
    requests.push({ authorization: request.headers.authorization, ...data });
    response.setHeader("Content-Type", "application/json");
    if (rejectRequests) {
      response.writeHead(503);
      response.end("{}");
      return;
    }
    let content = "OK";
    if (data.messages[0].content !== "Reply with OK.") {
      const input = JSON.parse(data.messages[1].content);
      content = JSON.stringify({
        items: input.items.map((item) => ({
          id: item.id,
          text: "大家好，这条字幕更自然。",
        })),
      });
    }
    response.end(JSON.stringify({ choices: [{ message: { content } }] }));
  } catch {
    response.writeHead(400);
    response.end("{}");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
try {
  app = await electron.launch({ args: ["."], env });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "首选项", exact: true }).click();
  await expect(page.getByLabel("AI 模型名称")).toBeEnabled();
  await page.getByLabel("AI API 基础地址").fill(endpoint);
  await page.getByLabel("AI 模型名称").fill("local-test-model");
  await page.getByLabel("AI API 密钥").fill("local-test-secret");
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("AI 连接测试成功", {
    timeout: 20000,
  });
  await page.screenshot({ path: path.join(root, "preferences.png") });
  await page.getByRole("button", { name: "保存首选项", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const preferences = await fs.readFile(
    path.join(profile, "preferences.json"),
    "utf8",
  );
  assert(!preferences.includes("local-test-secret"));
  await page.getByRole("button", { name: "首选项", exact: true }).click();
  await expect(page.getByLabel("AI 模型名称")).toHaveValue("local-test-model");
  await expect(page.getByLabel("AI API 密钥")).toHaveValue("");
  await page.getByRole("button", { name: "关闭首选项", exact: true }).click();
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page.getByRole("button", { name: "字幕", exact: true }).click();
  await page.getByRole("button", { name: "字幕操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "语音转文本", exact: true }).click();
  await expect(page.getByLabel("断句方式")).toHaveValue("standard");
  await page.getByLabel("断句方式").selectOption("custom");
  await page.getByLabel("每条字幕字数上限").fill("16");
  await page.getByLabel("文字精修").selectOption("polish");
  await page.screenshot({ path: path.join(root, "segmentation.png") });
  await page.getByRole("button", { name: "开始识别", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "时间线上没有可识别的声音",
  );
  assert.equal(
    JSON.parse(
      await fs.readFile(path.join(profile, "preferences.json"), "utf8"),
    ).captions.maxChars,
    16,
  );
  await page.getByRole("button", { name: "添加字幕", exact: true }).click();
  const text = page.locator(".caption-row textarea");
  const original = "大家好这个字幕需要润色。";
  await text.fill(original);
  await page.getByRole("button", { name: "字幕操作", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "AI 精修与润色", exact: true })
    .click();
  await page.getByRole("button", { name: "开始精修", exact: true }).click();
  await expect(text).toHaveValue("大家好，这条字幕更自然。", {
    timeout: 20000,
  });
  await page.screenshot({ path: path.join(root, "polished.png") });
  // Undo restores only this edit, with the caption and its timing retained.
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(text).toHaveValue(original);
  rejectRequests = true;
  await page.getByRole("button", { name: "字幕操作", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "AI 精修与润色", exact: true })
    .click();
  await page.getByRole("button", { name: "开始精修", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保留规则结果或原文");
  await expect(text).toHaveValue(original);
  assert(
    requests.every(
      (request) =>
        request.model === "local-test-model" &&
        request.authorization === "Bearer local-test-secret",
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "首选项加密保存、AI 连接、断句设置持久化、字幕润色、撤销与失败回退通过",
  );
  await fs.writeFile(
    path.join(root, "result.json"),
    JSON.stringify({ root, requestCount: requests.length, errors }, null, 2),
  );
} finally {
  await app?.close();
  await new Promise((resolve) => server.close(resolve));
}
