import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { selectPreview } from "./preview-select.mjs";

if (process.platform !== "win32")
  throw new Error("Windows recording window test");
const root = path.resolve(
  "test-output/recording-window-ui",
  `run-${Date.now()}`,
);
await fs.mkdir(root, { recursive: true });
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: path.join(root, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["."], env });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const mainId = await app.evaluate(
    ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].id,
  );
  const target = await app.evaluate(async ({ BrowserWindow }) => {
    const target = new BrowserWindow({
      width: 480,
      height: 320,
      x: 80,
      y: 80,
      backgroundColor: "#ffffff",
      skipTaskbar: true,
    });
    await target.loadURL(
      "data:text/html,<title>Recording window fixture</title><body style='background:white'>Recording fixture</body>",
    );
    return target.getMediaSourceId();
  });
  const minimized = () =>
    app.evaluate(
      ({ BrowserWindow }, id) => BrowserWindow.fromId(id).isMinimized(),
      mainId,
    );
  const mainRestored = async () => {
    await expect.poll(minimized).toBe(false);
    expect(
      await app.evaluate(
        ({ BrowserWindow }, id) => BrowserWindow.fromId(id).isVisible(),
        mainId,
      ),
    ).toBe(true);
  };
  await page.getByRole("button", { name: "新建录制", exact: true }).click();
  const modal = page.locator(".recorder-modal");
  const close = page.getByRole("button", { name: "关闭录制设置", exact: true });
  await modal.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(close).toBeInViewport();
  const heading = await page
    .locator(".recorder-modal > .modal-heading")
    .boundingBox();
  const frame = await modal.boundingBox();
  expect(Math.abs(heading.y - frame.y)).toBeLessThanOrEqual(2);
  await page.screenshot({ path: path.join(root, "sticky-close.png") });
  await close.click();
  await expect(modal).toHaveCount(0);

  async function configure(native) {
    await page.getByRole("button", { name: "录制", exact: true }).click();
    await page
      .locator(`.capture-sources > button[data-source-id="${target}"]`)
      .click();
    await page.getByLabel("麦克风", { exact: true }).uncheck();
    await page.getByLabel("录制帧率", { exact: true }).selectOption("15");
    await selectPreview(page, "录屏背景", "none");
    await page
      .getByLabel("原生录制与可编辑鼠标", { exact: true })
      .setChecked(native);
  }
  async function begin() {
    const opened = app.waitForEvent("window");
    await page.getByRole("button", { name: "开始录制", exact: true }).click();
    const overlay = await opened;
    await expect(overlay.locator("strong")).toHaveText("3");
    await expect.poll(minimized).toBe(true);
    return overlay;
  }
  await configure(true);
  const countdown = await begin();
  await countdown
    .getByRole("button", { name: "取消 · Esc", exact: true })
    .click();
  await mainRestored();
  await expect(
    page.getByRole("button", { name: "开始录制", exact: true }),
  ).toBeEnabled();
  await close.click();

  for (const native of [true, false]) {
    await configure(native);
    await begin();
    await expect(page.getByText("正在录制", { exact: true })).toBeVisible({
      timeout: 30000,
    });
    expect(await minimized()).toBe(true);
    await page.waitForTimeout(1200);
    // Same renderer command delivered by the global stop shortcut, while minimized.
    await app.evaluate(
      ({ BrowserWindow }, id) =>
        BrowserWindow.fromId(id).webContents.send("shortcut", "stopRecording"),
      mainId,
    );
    await expect(page.getByRole("status")).toContainText("录制完成", {
      timeout: 30000,
    });
    await mainRestored();
    await expect(page.locator(".recording-bar")).toHaveCount(0);
  }
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.framecraft.readRecovery()))?.project
          .assets.length,
    )
    .toBe(2);
  const project = (await page.evaluate(() => window.framecraft.readRecovery()))
    .project;
  for (const asset of project.assets)
    expect((await fs.stat(asset.path)).size).toBeGreaterThan(1000);
  await page.screenshot({ path: path.join(root, "recording-restored.png") });

  await configure(true);
  await app.evaluate(() => {
    process.env["FRAMECRAFT_WGC-CAPTURE"] = "Z:/troncut-test-missing.exe";
  });
  await begin();
  await expect(page.locator(".recorder-modal .error-box")).toBeVisible({
    timeout: 30000,
  });
  await mainRestored();
  await expect(
    page.getByRole("button", { name: "开始录制", exact: true }),
  ).toBeEnabled();
  await app.evaluate(() => {
    delete process.env["FRAMECRAFT_WGC-CAPTURE"];
  });
  await expect(
    page.evaluate(() => window.framecraft.recordingCountdown("window:0:0")),
  ).rejects.toThrow();
  await mainRestored();
  await close.click();
  expect(errors).toEqual([]);
  console.log(
    `固定关闭按钮、倒计时取消、原生/兼容录制最小化与快捷键停止恢复、来源失效和启动失败恢复通过：${root}`,
  );
} catch (error) {
  await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows())
      if (window.isMinimized()) window.restore();
  });
  await (
    await app.firstWindow()
  )
    .screenshot({ path: path.join(root, "failure.png") })
    .catch(() => {});
  throw error;
} finally {
  await app.close();
}
