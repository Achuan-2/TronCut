import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { selectPreview } from "./preview-select.mjs";
import { recordingControls } from "./recording-controls.mjs";

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
const packaged = process.env.FRAMECRAFT_PACKAGED_SMOKE === "1";
const app = await electron.launch({
  ...(packaged
    ? {
      executablePath: path.resolve(
        process.env.FRAMECRAFT_PACKAGED_APP ??
        "release/win-unpacked/TronCut.exe",
      ),
    }
    : {}),
  args: packaged ? [] : ["."],
  env,
});
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

  async function configure(native, source = target) {
    await page.getByRole("button", { name: "录制", exact: true }).click();
    await page
      .locator(
        source === "screen"
          ? '.capture-sources > button[data-source-id^="screen:"]'
          : `.capture-sources > button[data-source-id="${source}"]`,
      )
      .first()
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
  await page.evaluate(() => window.framecraft.cancelRecordingCountdown());
  await mainRestored();
  await expect(
    page.getByRole("button", { name: "开始录制", exact: true }),
  ).toBeEnabled();
  await close.click();

  for (const native of [true, false]) {
    await configure(native, native ? "screen" : target);
    await begin();
    const controls = await recordingControls(app);
    controls.on("pageerror", (error) => errors.push(error.message));
    expect(await minimized()).toBe(true);
    await expect(page.locator(".recorder-modal, .recording-bar")).toHaveCount(
      0,
    );
    const properties = await app.evaluate(({ BrowserWindow }) => {
      const controls = BrowserWindow.getAllWindows().find(
        (w) => w.getTitle() === "TronCut 录制控制",
      );
      return {
        top: controls.isAlwaysOnTop(),
        parent: controls.getParentWindow()?.id,
        sandbox: controls.webContents.getLastWebPreferences().sandbox,
        // Windows rounds the scaled frameless border up by up to 2 DIP.
        compact:
          controls.getBounds().width <= 274 &&
          controls.getBounds().height <= 44,
        minimizable: controls.isMinimizable(),
      };
    });
    expect(properties).toEqual({
      top: true,
      parent: undefined,
      sandbox: true,
      compact: true,
      minimizable: true,
    });
    expect(
      await controls
        .locator("main")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await controls
      .getByRole("button", { name: "暂停录制", exact: true })
      .click();
    await expect(controls.getByRole("status")).toHaveText("已暂停");
    await expect(controls.locator("#play-icon")).toBeVisible();
    await expect(controls.locator("#pause-icon")).toBeHidden();
    await page.waitForTimeout(350);
    const pausedTime = await controls.locator("time").textContent();
    await page.waitForTimeout(1100);
    await expect(controls.locator("time")).toHaveText(pausedTime);
    await controls.screenshot({
      path: path.join(root, `controls-paused-${native}.png`),
    });
    await controls
      .getByRole("button", { name: "继续录制", exact: true })
      .click();
    await expect(controls.getByRole("status")).toHaveText("正在录制");
    await expect(controls.locator("#pause-icon")).toBeVisible();
    await expect(controls.locator("#play-icon")).toBeHidden();
    await controls
      .getByRole("button", { name: "显示编辑器", exact: true })
      .click();
    await mainRestored();
    const recall = page.getByRole("button", { name: "录制控制", exact: true });
    await expect(recall).toBeEnabled();
    const beforeMinimize = await controls.locator("time").textContent();
    await controls.getByRole("button", { name: "最小化", exact: true }).click();
    const controlsMinimized = () =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.getTitle() === "TronCut 录制控制")
          .isMinimized(),
      );
    await expect.poll(controlsMinimized).toBe(true);
    await page.waitForTimeout(1200);
    expect(await controlsMinimized()).toBe(true);
    await expect(controls.getByRole("status")).toHaveText("正在录制");
    await expect(controls.locator("time")).not.toHaveText(beforeMinimize);
    await recall.click();
    await recordingControls(app);
    await app.evaluate(({ BrowserWindow }) => {
      const controls = BrowserWindow.getAllWindows().find(
        (w) => w.getTitle() === "TronCut 录制控制",
      );
      controls.setPosition(-30000, -30000);
      controls.hide();
    });
    await recall.click();
    await recordingControls(app);
    const placement = await app.evaluate(({ BrowserWindow, screen }) => {
      const controls = BrowserWindow.getAllWindows().find(
        (w) => w.getTitle() === "TronCut 录制控制",
      );
      const bounds = controls.getBounds();
      const area = screen.getDisplayMatching(bounds).workArea;
      return {
        centered:
          Math.abs(bounds.x + bounds.width / 2 - area.x - area.width / 2) <= 1,
        inside:
          bounds.y >= area.y &&
          bounds.y + bounds.height <= area.y + area.height,
      };
    });
    expect(placement).toEqual({ centered: true, inside: true });
    const projectName = page.getByRole("textbox", {
      name: "项目名称",
      exact: true,
    });
    await expect(projectName).toBeEnabled();
    await projectName.fill(`录制中编辑 ${native}`);
    await page.waitForTimeout(1200);
    await controls
      .getByRole("button", { name: "停止录制", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("录制完成", {
      timeout: 30000,
    });
    await mainRestored();
    await expect.poll(() => controls.isClosed()).toBe(true);
    await expect(page.locator(".recording-bar")).toHaveCount(0);
  }
  const self = await app.evaluate(
    ({ BrowserWindow }, id) => BrowserWindow.fromId(id).getMediaSourceId(),
    mainId,
  );
  for (const native of [true, false]) {
    await configure(native, self);
    const countdownOpened = app.waitForEvent("window");
    await page.getByRole("button", { name: "开始录制", exact: true }).click();
    const countdown = await countdownOpened;
    await expect(countdown.locator("strong")).toHaveText("3");
    const countdownName = page.getByRole("textbox", { name: "项目名称", exact: true });
    await expect(countdownName).toBeEnabled();
    await countdownName.fill(`倒计时期间编辑 ${native}`);
    await countdownName.blur();
    await page.keyboard.press("Control+z");
    await expect(countdownName).not.toHaveValue(`倒计时期间编辑 ${native}`);
    const controls = await recordingControls(app);
    expect(await minimized()).toBe(false);
    await expect(page.locator(".recorder-modal, .recording-bar")).toHaveCount(
      0,
    );
    const name = page.getByRole("textbox", { name: "项目名称", exact: true });
    await name.fill(`TronCut 自录 ${native}`);
    await name.blur();
    await page.keyboard.press("Control+z");
    await expect(name).not.toHaveValue(`TronCut 自录 ${native}`);
    await page.waitForTimeout(1200);
    if (native) {
      // Closing the controller saves, just like its Stop button.
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.getTitle() === "TronCut 录制控制")
          .close(),
      );
    } else {
      // Retain global stop command support.
      await app.evaluate(
        ({ BrowserWindow }, id) =>
          BrowserWindow.fromId(id).webContents.send(
            "shortcut",
            "stopRecording",
          ),
        mainId,
      );
    }
    await expect(page.getByRole("status")).toContainText("录制完成", {
      timeout: 30000,
    });
    await expect.poll(() => controls.isClosed()).toBe(true);
  }
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.framecraft.readRecovery()))?.project
          .assets.length,
    )
    .toBe(4);
  const project = (await page.evaluate(() => window.framecraft.readRecovery()))
    .project;
  for (const asset of project.assets)
    expect((await fs.stat(asset.path)).size).toBeGreaterThan(1000);
  await page.screenshot({ path: path.join(root, "recording-restored.png") });

  await configure(true);
  await app.evaluate(() => {
    process.env["FRAMECRAFT_WGC-CAPTURE"] = "Z:/troncut-test-missing.exe";
  });
  // Prewarming may report a missing engine before the countdown even paints.
  await page.getByRole("button", { name: "开始录制", exact: true }).click();
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
    `独立录制控制窗、原生/兼容暂停继续、计时冻结、显示编辑器、自录与编辑快捷键、停止/关闭保存及异常恢复通过：${root}`,
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
    .catch(() => { });
  throw error;
} finally {
  await app.close();
}
