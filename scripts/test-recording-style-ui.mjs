import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

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
const app = await electron.launch({ args: ["."], env });
const errors = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  const ownId = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getMediaSourceId(),
  );
  await page.getByRole("button", { name: "新建录制", exact: true }).click();
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
    page.getByLabel("根据鼠标点击和停留自动缩放", { exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel("录屏背景", { exact: true })).toBeEnabled();
  await native.check();
  await page.getByLabel("麦克风", { exact: true }).uncheck();
  await page.getByLabel("录制帧率", { exact: true }).selectOption("15");
  await page.getByLabel("录屏背景", { exact: true }).selectOption("sunset");
  await page.getByLabel("录屏留白", { exact: true }).fill("12");
  await page.getByLabel("录屏圆角", { exact: true }).fill("24");
  await page.getByLabel("录屏鼠标样式", { exact: true }).selectOption("circle");
  await page.getByLabel("录屏鼠标大小", { exact: true }).fill("56");
  await page.getByLabel("自动缩放倍数", { exact: true }).selectOption("2.5");
  await page.screenshot({ path: path.join(root, "configure.png") });
  await page.getByRole("button", { name: "开始录制", exact: true }).click();
  await expect(page.getByText("正在录制", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await page.waitForTimeout(2200);
  const pause = page.locator(".recording-bar > button").first();
  await pause.click();
  await expect(page.getByText("已暂停", { exact: true })).toBeVisible();
  await pause.click();
  await page.getByRole("button", { name: "结束录制", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("录制完成", {
    timeout: 30000,
  });
  await expect(page.locator(".asset-card")).toHaveCount(2);
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
  expect(screen.mediaFrame).toEqual({ radius: 24 });
  const asset = recorded.assets.find((a) => a.id === screen.assetId);
  expect(asset.cursor.samples.length).toBeGreaterThan(0);
  expect((await fs.stat(asset.path)).size).toBeGreaterThan(1000);
  await page.locator(".timeline-clip.video").click();
  await page.getByRole("tab", { name: "鼠标", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "鼠标样式", exact: true }),
  ).toHaveValue("circle");
  await expect(
    page.getByRole("spinbutton", { name: "鼠标大小", exact: true }),
  ).toHaveValue("56");
  await page.getByRole("tab", { name: "视频", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "根据鼠标重新生成缩放", exact: true }),
  ).toBeVisible();
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(page.locator(".timeline-clip")).toHaveCount(0);
  await page.getByTitle("重做 Ctrl+Shift+Z", { exact: true }).click();
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
  await expect
    .poll(() =>
      page
        .locator(".preview-layer.image img")
        .evaluate((img) => img.complete && img.naturalWidth > 0),
    )
    .toBe(true);
  await page.screenshot({ path: path.join(root, "recorded.png") });
  await page.getByRole("button", { name: "录制", exact: true }).click();
  await expect(page.getByLabel("录屏背景", { exact: true })).toHaveValue(
    "sunset",
  );
  await expect(page.getByLabel("录屏鼠标大小", { exact: true })).toHaveValue(
    "56",
  );
  await expect(page.getByLabel("自动缩放倍数", { exact: true })).toHaveValue(
    "2.5",
  );
  const settings = JSON.parse(
    await fs.readFile(path.join(profile, "recording-settings.json"), "utf8"),
  );
  expect(settings).toMatchObject({
    preset: "sunset",
    padding: 0.12,
    radius: 24,
    zoom: 2.5,
  });
  expect(errors).toEqual([]);
  console.log(
    `真实 WGC 录屏、暂停继续、鼠标预设、背景分轨、撤销重做、归档图片加载和选项持久化通过：${root}`,
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
