import { _electron as electron, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
const base = path.resolve("test-output/smoke");
const root = path.join(base, `run-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: path.join(root, `profile-${Date.now()}`),
};
delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.env.FRAMECRAFT_PACKAGED_SMOKE === "1";
const app = await electron.launch({
  ...(packaged
    ? {
        executablePath: path.resolve("release/win-unpacked/TronCut.exe"),
      }
    : {}),
  args: packaged ? [] : ["."],
  env,
  timeout: 30000,
});
app.process().stderr.on("data", (data) => process.stderr.write(data));
app.process().stdout.on("data", (data) => process.stdout.write(data));
const errors = [];
try {
  const page = await app.firstWindow();
  page.on("console", (message) => {
    if (message.type() === "error") console.error(message.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page.getByLabel("工程名称").fill("我的第一个视频");
  // Create the two editable text fixtures explicitly; launch now opens Home.
  await page.getByRole("button", { name: "添加文本", exact: true }).click();
  await page.getByLabel("文本内容").fill("把想法，变成作品。");
  await page.getByRole("button", { name: "添加文本", exact: true }).click();
  await page.getByLabel("文本内容").fill("录制 · 剪辑 · 表达");
  await expect(
    page.getByRole("toolbar", { name: "画布工具", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".workspace-status")).toContainText(
    "媒体引擎就绪",
    { timeout: 20000 },
  );
  await page.screenshot({ path: path.join(root, "editor.png") });
  await page.getByRole("button", { name: "字幕", exact: true }).click();
  await page.getByLabel("识别引擎").selectOption("sensevoice");
  await expect(page.getByLabel("计算设备")).toHaveValue("auto");
  await page.getByLabel("语言").selectOption("yue");
  await page.getByLabel("识别引擎").selectOption("paraformer");
  await expect(page.getByLabel("语言")).toHaveValue("auto");
  await page.getByRole("button", { name: "媒体", exact: true }).click();
  await page.getByRole("button", { name: "添加文本", exact: true }).click();
  await page.getByLabel("文本内容").fill("TronCut：中文文本与动画");
  await expect(page.locator(".timeline-clip")).toHaveCount(3);
  await page.getByRole("button", { name: "配音", exact: true }).click();
  await page.getByRole("button", { name: "读取选中文本", exact: true }).click();
  await expect(page.getByLabel("配音文字")).toHaveValue(
    "TronCut：中文文本与动画",
  );
  await page.getByLabel("配音模型", { exact: true }).selectOption("vits-onnx");
  await page.getByLabel("配音模型目录").fill("C:/我的模型/vits");
  await page.getByRole("button", { name: "媒体", exact: true }).click();
  await page.getByRole("button", { name: "配音", exact: true }).click();
  await expect(page.getByLabel("配音文字")).toHaveValue(
    "TronCut：中文文本与动画",
  );
  await expect(page.getByLabel("配音模型目录")).toHaveValue("C:/我的模型/vits");
  await page.getByLabel("配音模型", { exact: true }).selectOption("kokoro-onnx");
  await expect(page.getByLabel("配音音色")).toHaveValue("10");
  await expect(page.getByLabel("配音模型目录")).toHaveValue("");
  await expect(page.getByLabel("语气指令")).toHaveCount(0);
  await expect(page.getByLabel("配音设备")).toHaveValue("cpu");
  await page.getByRole("button", { name: "媒体", exact: true }).click();
  await page.getByRole("button", { name: "自动动画", exact: true }).click();
  await page.getByRole("tab", { name: "画面", exact: true }).click();
  const ruler = await page.locator(".ruler").boundingBox();
  await page.mouse.click(ruler.x + 65 * 3, ruler.y + 12);
  await page.getByLabel("位置 X (%)").fill("70");
  await expect(
    page.locator(".timeline-clip.selected .clip-animation"),
  ).toHaveCount(1);
  await page.locator(".timeline-clip.selected").click({ button: "right" });
  await expect(
    page.getByRole("button", { name: "添加缩放动画", exact: true }),
  ).toHaveCount(0);
  await page.mouse.click(ruler.x + 65 * 3, ruler.y + 12);
  await page
    .locator(".timeline-clip.selected .animation-arrow")
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "启用缓冲", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "线性", exact: true }).click();
  await expect(
    page.locator(".timeline-clip.selected .clip-animation"),
  ).toHaveCount(1);
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, path.resolve("test-output/源视频.mp4"));
  await page.getByRole("button", { name: "导入媒体", exact: true }).click();
  await expect(page.locator(".asset-card")).toHaveCount(1, { timeout: 20000 });
  await page.locator(".asset-card").dblclick();
  await expect(page.locator(".timeline-clip")).toHaveCount(4);
  await page.locator(".timeline-clip.text").nth(0).click();
  await page
    .locator(".timeline-clip.text")
    .nth(1)
    .click({ modifiers: ["Control"] });
  await expect(page.locator(".timeline-clip.selected")).toHaveCount(2);
  await page.getByRole("button", { name: "组合", exact: true }).click();
  await page.getByTitle("撤销 Ctrl+Z").click();
  await page.locator(".timeline-clip.video").click();
  await expect(page.getByLabel("裁切左侧 (%)")).toHaveCount(0);
  await page.getByLabel("旋转 Z (度)").fill("15");
  await expect(page.getByLabel("效果预设")).toHaveCount(0);
  await page.getByLabel("水平翻转", { exact: true }).check();
  await expect(
    page.locator(".asset-thumbnail img.thumbnail-image"),
  ).toHaveCount(1, { timeout: 20000 });
  await page.getByRole("button", { name: "音频", exact: true }).click();
  await page.getByRole("button", { name: "应用播客人声", exact: true }).click();
  await page.getByRole("button", { name: "处理后试听", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("正在试听处理后的音频", {
    timeout: 20000,
  });
  await page.getByRole("button", { name: "停止试听", exact: true }).click();
  await page.getByRole("button", { name: "媒体", exact: true }).click();
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [folder],
    });
  }, root);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByText("工程已保存，所有素材已归档到工程文件夹", { exact: true }),
  ).toBeVisible({ timeout: 20000 });
  const folders = await fs.readdir(root);
  const projectFolder = folders.find((f) => f.startsWith("我的第一个视频"));
  const saved = JSON.parse(
    await fs.readFile(
      path.join(root, projectFolder, "我的第一个视频.troncut"),
      "utf8",
    ),
  );
  if (saved.clips.length !== 4 || !saved.assets[0].path.startsWith("media/"))
    throw new Error("工程收集素材验证失败");
  await app.evaluate(
    ({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: target,
      });
    },
    path.join(root, "desktop-export.mp4"),
  );
  await page.getByRole("button", { name: "导出视频", exact: true }).click();
  const exportStart = Date.now();
  await expect(page.getByRole("status")).toContainText("视频已导出", {
    timeout: 90000,
  });
  const sources = await page.evaluate(() => window.framecraft.captureSources());
  const exportMs = Date.now() - exportStart;
  console.log(`发现 ${sources.length} 个屏幕/窗口来源`);
  await page.screenshot({ path: path.join(root, "edited.png") });
  if (process.env.FRAMECRAFT_RECORDING_SMOKE === "1") {
    await page.getByRole("button", { name: "录制", exact: true }).click();
    await page
      .getByText("麦克风", { exact: true })
      .locator("..")
      .locator("input")
      .uncheck();
    const ownWindow = page
      .locator(".capture-sources > button")
      .filter({ hasText: "TronCut" })
      .first();
    if (await ownWindow.count()) await ownWindow.click();
    await page.getByRole("button", { name: "开始录制", exact: true }).click();
    await expect(page.getByText("正在录制", { exact: true })).toBeVisible({
      timeout: 20000,
    });
    await page.waitForTimeout(1800);
    const pause = page.locator(".recording-bar > button").first();
    await pause.click();
    await expect(page.getByText("已暂停", { exact: true })).toBeVisible();
    await page.waitForTimeout(200);
    await pause.click();
    await page.getByRole("button", { name: "结束录制", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("录制完成", {
      timeout: 30000,
    });
    await expect(page.locator(".asset-card")).toHaveCount(2);
    const native = await page.evaluate(() =>
      window.framecraft.nativeCaptureAvailable(),
    );
    if (native) {
      await page.locator(".timeline-clip.video").last().click();
      await page.getByRole("tab", { name: "鼠标", exact: true }).click();
      await expect(page.getByLabel("鼠标样式")).toBeVisible();
      await page.getByLabel("鼠标样式").selectOption("circle");
      await page.getByRole("button", { name: "保存", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("工程已保存", {
        timeout: 20000,
      });
      const disk = JSON.parse(
        await fs.readFile(
          path.join(root, projectFolder, "我的第一个视频.troncut"),
          "utf8",
        ),
      );
      const cursor = disk.assets.find((a) => a.cursorPath);
      if (!cursor) throw new Error("原生录屏没有持久化鼠标数据");
      const sidecar = JSON.parse(
        await fs.readFile(
          path.join(root, projectFolder, cursor.cursorPath),
          "utf8",
        ),
      );
      if (!sidecar.samples.length) throw new Error("鼠标采样为空");
      await page.getByRole("button", { name: "导出视频", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("视频已导出", {
        timeout: 90000,
      });
      console.log(
        `原生 WGC 录屏、${sidecar.samples.length} 个鼠标样本、样式修改、独立 JSON 与真实导出通过`,
      );
    } else console.log("兼容录屏、流式落盘、WebM 时长修复与加入时间线通过");
  }
  if (errors.length) throw new Error(errors.join("\n"));
  await fs.writeFile(
    path.join(base, "latest.json"),
    JSON.stringify(
      {
        root,
        packaged,
        recorded: process.env.FRAMECRAFT_RECORDING_SMOKE === "1",
        exportMs,
        checkedAt: new Date().toISOString(),
        rendererErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "桌面 UI、文本编辑、自动关键帧、动画右键缓动、素材导入、工程归档与 MP4 导出通过",
  );
} finally {
  await app.close();
}
