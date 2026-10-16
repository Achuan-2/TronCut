import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve("test-output/recordly-ui", `run-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: path.join(root, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["."], env });
try {
  const page = await app.firstWindow(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "新建录制", exact: true }).click();
  await expect(page.getByLabel("录屏背景", { exact: true })).toBeEnabled();
  await page.getByLabel("麦克风", { exact: true }).uncheck();
  await expect(page.getByLabel("背景图库")).toHaveCount(0);
  await expect(
    page.getByLabel("录屏背景", { exact: true }).locator("option"),
  ).toHaveCount(6);
  await expect(
    page
      .getByLabel("录屏背景", { exact: true })
      .locator("optgroup[label='动态背景']"),
  ).toHaveCount(0);
  await page
    .getByLabel("录屏背景", { exact: true })
    .selectOption("perspective-grid");
  const grid = page.locator("img.recording-wallpaper-preview");
  await expect
    .poll(() =>
      grid.evaluate((image) => image.complete && image.naturalWidth > 0),
    )
    .toBe(true);
  await page.screenshot({
    path: path.join(root, "perspective-grid-settings.png"),
  });
  await page.getByLabel("自动缩放范围", { exact: true }).selectOption("scene");
  for (const style of [
    "macos",
    "tahoe",
    "tahoe-inverted",
    "windows11",
    "figma",
    "dot",
  ]) {
    await page.getByLabel("录屏鼠标样式", { exact: true }).selectOption(style);
    await expect
      .poll(() =>
        page
          .getByAltText("鼠标预览")
          .evaluate((el) => el.complete && el.naturalWidth > 0),
      )
      .toBe(true);
  }
  await page
    .getByLabel("录屏鼠标样式", { exact: true })
    .selectOption("windows11");
  await page.screenshot({ path: path.join(root, "settings.png") });
  const opened = app.waitForEvent("window");
  await page.getByRole("button", { name: "开始录制", exact: true }).click();
  const overlay = await opened;
  await expect(overlay.locator("strong")).toHaveText("3");
  const geometry = await app.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().startsWith("data:text/html"),
    );
    const bounds = win.getBounds();
    return {
      bounds,
      display: screen.getDisplayMatching(bounds).bounds,
      top: win.isAlwaysOnTop(),
    };
  });
  for (const key of ["x", "y", "width", "height"])
    expect(
      Math.abs(geometry.bounds[key] - geometry.display[key]),
    ).toBeLessThanOrEqual(1);
  expect(geometry.top).toBe(true);
  await overlay.screenshot({
    path: path.join(root, "fullscreen-countdown.png"),
  });
  await overlay
    .getByRole("button", { name: "取消 · Esc", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "开始录制", exact: true }),
  ).toBeEnabled();
  expect(
    await app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
    ),
  ).toBe(1);
  await expect(page.getByText("正在录制", { exact: true })).toHaveCount(0);
  // Exercise normal completion independently of capture permissions and hardware.
  const nextWindow = app.waitForEvent("window");
  const completed = page.evaluate(async () => {
    const sources = await window.framecraft.captureSources();
    return window.framecraft.recordingCountdown(sources[0].id);
  });
  const next = await nextWindow;
  await expect(next.locator("strong")).toHaveText("3");
  await expect(next.locator("strong")).toHaveText("2");
  await expect(next.locator("strong")).toHaveText("1");
  expect(await completed).toBe(true);
  await page.getByRole("button", { name: "关闭录制设置", exact: true }).click();
  const saved = await page.evaluate(() =>
    window.framecraft.recordingSettings(),
  );
  expect(saved).toMatchObject({
    preset: "perspective-grid",
    zoomBackground: true,
    cursor: { style: "windows11" },
  });
  expect(errors).toEqual([]);
  console.log(
    `精简背景、全部鼠标样式、设置记忆、全屏倒计时与取消/完成通过：${root}`,
  );
} finally {
  await app.close();
}
