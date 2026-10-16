import { _electron as electron, expect } from "@playwright/test";
import { recordingControls } from "./recording-controls.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { selectPreview } from "./preview-select.mjs";

const root = path.resolve(
  "test-output/recording-style-ui",
  `run-${Date.now()}`,
);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
let app = await electron.launch({ args: ["."], env });
const errors = [];
try {
  let page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "新建录制", exact: true }).click();
  await expect(page.getByLabel("录屏背景", { exact: true })).toBeEnabled();
  await expect(page.getByLabel("录屏圆角", { exact: true })).toHaveValue("0");
  await expect(page.getByLabel("麦克风", { exact: true })).toBeChecked();
  await page.getByLabel("麦克风", { exact: true }).uncheck();
  await selectPreview(page, "录屏背景", "violet");
  for (const [label, value] of [
    ["录屏留白", "10"],
    ["录屏圆角", "7"],
  ]) {
    const input = page.getByLabel(label, { exact: true });
    await input.fill("");
    await expect(input).toHaveValue("");
    await input.pressSequentially(value);
    await expect(input).toHaveValue(value);
    await input.fill("");
    await input.blur();
    await expect(input).toHaveValue(value);
  }
  await page.getByRole("button", { name: "关闭录制设置", exact: true }).click();
  await expect(page.locator(".recorder-modal")).toHaveCount(0);
  // No recording has started: closing the configuration must still persist it.
  await app.close();
  app = await electron.launch({ args: ["."], env });
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  const ownId = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getMediaSourceId(),
  );
  await page.getByRole("button", { name: "新建录制", exact: true }).click();
  await expect(page.getByLabel("录屏背景", { exact: true })).toHaveAttribute(
    "data-value",
    "violet",
  );
  await expect(page.getByLabel("录屏留白", { exact: true })).toHaveValue("10");
  await expect(page.getByLabel("录屏圆角", { exact: true })).toHaveValue("7");
  await expect(page.getByLabel("麦克风", { exact: true })).not.toBeChecked();
  const ownWindow = page.locator(
    `.capture-sources > button[data-source-id="${ownId}"]`,
  );
  await expect(ownWindow).toHaveCount(1, { timeout: 20000 });
  await ownWindow.click();
  const native = page.getByLabel("原生录制与可编辑鼠标", { exact: true });
  await expect(native).toBeChecked();
  await native.uncheck();
  await expect(page.getByLabel("录屏鼠标样式", { exact: true })).toBeDisabled();
  await expect(
    page.getByLabel("根据鼠标点击自动缩放并跟随移动", { exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel("录屏背景", { exact: true })).toBeEnabled();
  await native.check();
  await page.getByLabel("麦克风", { exact: true }).uncheck();
  await page.getByLabel("录制帧率", { exact: true }).selectOption("15");
  await selectPreview(page, "录屏背景", "sunset");
  await page.getByLabel("录屏留白", { exact: true }).fill("12");
  await page.getByLabel("录屏圆角", { exact: true }).fill("24");
  await selectPreview(page, "录屏鼠标样式", "circle");
  await page.getByLabel("录屏鼠标大小", { exact: true }).fill("56");
  await page.getByLabel("自动缩放倍数", { exact: true }).selectOption("2.5");
  await page.screenshot({ path: path.join(root, "configure.png") });
  await page.getByRole("button", { name: "开始录制", exact: true }).click();
  const controls = await recordingControls(app);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(false);
  await page.waitForTimeout(2200);
  const pause = controls.locator("#pause");
  await pause.click();
  await expect(controls.getByRole("status")).toHaveText("已暂停");
  await pause.click();
  await controls.getByRole("button", { name: "停止录制", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("录制完成", {
    timeout: 30000,
  });
  await expect(page.locator(".asset-card")).toHaveCount(2);
  await expect(page.locator(".timeline-clip")).toHaveCount(1);
  await page.locator(".recording-object").click({ position: { x: 30, y: 10 } });
  await page.getByRole("button", { name: "取消组合", exact: true }).click();
  await expect(page.locator(".timeline-clip.image")).toContainText("录屏背景");
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.framecraft.readRecovery()))?.project
          .clips.length,
    )
    .toBe(2);
  const recorded = (await page.evaluate(() => window.framecraft.readRecovery()))
    .project;
  const screen = recorded.clips.find((c) => c.kind === "video");
  expect(screen.transform.scale).toBe(0.76);
  expect(screen.cursorStyle).toMatchObject({ style: "circle", size: 56 });
  expect(screen.mediaFrame).toEqual({ radius: 24, unit: "percent" });
  const asset = recorded.assets.find((a) => a.id === screen.assetId);
  expect(asset.name).toMatch(
    /^录屏 \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}-\d{3}\.mp4$/,
  );
  expect(path.basename(asset.path)).toBe(asset.name);
  expect(screen.name).toBe(asset.name);
  expect(asset.cursor.samples.length).toBeGreaterThan(0);
  expect((await fs.stat(asset.path)).size).toBeGreaterThan(1000);
  await page.locator(".timeline-clip.video").click();
  await page.getByRole("tab", { name: "鼠标", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "鼠标样式", exact: true }),
  ).toHaveAttribute("data-value", "circle");
  await expect(
    page.getByRole("spinbutton", { name: "鼠标大小", exact: true }),
  ).toHaveValue("56");
  await page.getByRole("tab", { name: "视频", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "根据鼠标重新生成缩放", exact: true }),
  ).toHaveCount(0);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(page.locator(".recording-object")).toHaveCount(1);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(page.locator(".timeline-clip")).toHaveCount(0);
  await page.getByTitle("重做 Ctrl+Shift+Z", { exact: true }).click();
  await expect(page.locator(".recording-object")).toHaveCount(1);
  await page.getByTitle("重做 Ctrl+Shift+Z", { exact: true }).click();
  await expect(page.locator(".timeline-clip")).toHaveCount(2);
  await page.locator(".timeline-clip.video").click();
  await page.getByRole("tab", { name: "视频", exact: true }).click();
  await page.getByLabel("圆角 (%)", { exact: true }).fill("0");
  await page.getByLabel("缩放 (%)", { exact: true }).fill("75");
  await expect(page.getByLabel("缩放 (%)", { exact: true })).toHaveValue("75");
  await page.getByRole("tab", { name: "鼠标", exact: true }).click();
  await selectPreview(page, "鼠标样式", "cross");
  await page
    .getByRole("spinbutton", { name: "鼠标大小", exact: true })
    .fill("48");
  await page.locator(".timeline-clip.image").click();
  await page.getByLabel("缩放 (%)", { exact: true }).fill("85");
  await page.locator(".timeline-clip.image").click({ button: "right" });
  await page.getByRole("button", { name: "删除片段", exact: true }).click();
  await expect(page.locator(".timeline-clip")).toHaveCount(1);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(page.locator(".timeline-clip")).toHaveCount(2);
  await page.getByLabel("工程名称").fill("录屏美化验收");
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
  const saved = JSON.parse(
    await fs.readFile(
      path.join(root, "录屏美化验收", "录屏美化验收.troncut"),
      "utf8",
    ),
  );
  expect(saved.assets.find((a) => a.kind === "image").path).toMatch(/\.png$/);
  expect(saved.clips.find((c) => c.kind === "video")).toMatchObject({
    mediaFrame: { radius: 0 },
    transform: { scale: 0.75 },
    cursorStyle: { style: "cross", size: 48 },
  });
  expect(saved.clips.find((c) => c.kind === "image").transform.scale).toBe(
    0.85,
  );
  await expect
    .poll(() =>
      page
        .locator(".preview-layer.image img")
        .evaluate((img) => img.complete && img.naturalWidth > 0),
    )
    .toBe(true);
  await page.screenshot({ path: path.join(root, "recorded.png") });
  await page.getByRole("button", { name: "录制", exact: true }).click();
  await expect(page.getByLabel("录屏背景", { exact: true })).toHaveAttribute(
    "data-value",
    "sunset",
  );
  await expect(page.getByLabel("录屏鼠标大小", { exact: true })).toHaveValue(
    "56",
  );
  await expect(page.getByLabel("自动缩放倍数", { exact: true })).toHaveValue(
    "2.5",
  );
  const settings = JSON.parse(
    await fs.readFile(path.join(profile, "preferences.json"), "utf8"),
  );
  expect(settings.recording).toMatchObject({
    preset: "sunset",
    padding: 0.12,
    radius: 24,
    zoom: 2.5,
  });
  await page.getByRole("button", { name: "关闭录制设置", exact: true }).click();
  await app.close();
  app = await electron.launch({ args: ["."], env });
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await app.evaluate(
    ({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    },
    path.join(root, "录屏美化验收", "录屏美化验收.troncut"),
  );
  await page.getByRole("button", { name: "打开项目", exact: true }).click();
  await page.locator(".timeline-clip.video").click();
  await page.getByRole("tab", { name: "视频", exact: true }).click();
  await expect(page.getByLabel("圆角 (%)", { exact: true })).toHaveValue("0");
  await expect(page.getByLabel("缩放 (%)", { exact: true })).toHaveValue("75");
  await page.getByRole("tab", { name: "鼠标", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "鼠标样式", exact: true }),
  ).toHaveAttribute("data-value", "cross");
  await expect(
    page.getByRole("spinbutton", { name: "鼠标大小", exact: true }),
  ).toHaveValue("48");
  await page.locator(".timeline-clip.image").click();
  await expect(page.getByLabel("缩放 (%)", { exact: true })).toHaveValue("85");
  expect(errors).toEqual([]);
  console.log(
    `默认直角、关闭后重启记忆、真实 WGC 录屏、录后圆角/留白/鼠标与背景编辑、撤销重做及工程重开通过：${root}`,
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
