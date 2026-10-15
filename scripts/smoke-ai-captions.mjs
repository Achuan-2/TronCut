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
          ...(data.messages[0].content.includes('"segments"')
            ? { segments: item.text.split(/(?<=[，。！？])/u).filter(Boolean) }
            : { text: "大家好，这条字幕更自然。" }),
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
  // Resegment existing captions without rerunning ASR. A mock fails if called.
  await app.evaluate(({ ipcMain }) => {
    globalThis.captionSegmentationASRCalls = 0;
    ipcMain.removeHandler("subtitles:transcribe");
    ipcMain.handle("subtitles:transcribe", () => {
      globalThis.captionSegmentationASRCalls++;
      throw new Error("断句不应重新识别语音");
    });
  });
  rejectRequests = false;
  const firstText = "你就直接和豆包提供数";
  const secondText = "据，指定分析方法，让它画图就可以了。";
  await text.fill(firstText);
  const ruler = await page.locator(".ruler").boundingBox();
  await page.mouse.click(ruler.x + 3 * 65, ruler.y + 15);
  await page.getByRole("button", { name: "添加字幕", exact: true }).click();
  await expect(page.locator(".caption-row textarea")).toHaveCount(2);
  await page.locator(".caption-row textarea").nth(1).fill(secondText);
  const rows = page.locator(".caption-row textarea");
  const openSegmentation = async () => {
    await page.getByRole("button", { name: "字幕操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "断句", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "字幕断句", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("断句方式").locator("option")).toHaveCount(4);
    await expect(page.getByLabel("文字精修")).toHaveCount(0);
  };
  const undoSegmentation = async () => {
    await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveValue(firstText);
    await expect(rows.nth(1)).toHaveValue(secondText);
  };
  const requestCount = requests.length;
  await openSegmentation();
  await page.screenshot({ path: path.join(root, "resegment-dialog.png") });
  await page.getByRole("button", { name: "应用断句", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已重新断句");
  assert(
    (await rows.evaluateAll((items) => items.map((item) => item.value))).every(
      (value) => !value.endsWith("数") && !value.startsWith("据"),
    ),
  );
  assert.equal(requests.length, requestCount);
  await page.screenshot({ path: path.join(root, "resegmented.png") });
  await undoSegmentation();
  await openSegmentation();
  await page.getByLabel("断句方式").selectOption("custom");
  await page.getByLabel("每条字幕字数上限").fill("8");
  await page.getByRole("button", { name: "应用断句", exact: true }).click();
  await expect.poll(() => rows.count()).toBeGreaterThan(2);
  await undoSegmentation();
  await openSegmentation();
  await page.getByLabel("断句方式").selectOption("unlimited");
  await page.getByRole("button", { name: "应用断句", exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toHaveValue(firstText + secondText);
  await undoSegmentation();
  await openSegmentation();
  await page.getByLabel("断句方式").selectOption("ai");
  await page.getByRole("button", { name: "应用断句", exact: true }).click();
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveValue("你就直接和豆包提供数据，");
  assert(requests.length > requestCount);
  await undoSegmentation();
  await page
    .locator(".track-header.caption-track")
    .getByTitle("锁定 / 解锁轨道", { exact: true })
    .click();
  await page.getByRole("button", { name: "字幕操作", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "断句", exact: true }),
  ).toBeDisabled();
  assert.equal(
    await app.evaluate(() => globalThis.captionSegmentationASRCalls),
    0,
  );
  assert(
    requests.every(
      (request) =>
        request.model === "local-test-model" &&
        request.authorization === "Bearer local-test-secret",
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "首选项、AI 润色、已有字幕四种断句、一次撤销和锁定轨道保护通过，重新断句未调用语音识别",
  );
  await fs.writeFile(
    path.join(root, "result.json"),
    JSON.stringify({ root, requestCount: requests.length, errors }, null, 2),
  );
} finally {
  await app?.close();
  await new Promise((resolve) => server.close(resolve));
}
