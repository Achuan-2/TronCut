import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { recordingControls } from "./recording-controls.mjs";
import { selectPreview } from "./preview-select.mjs";

const run = promisify(execFile);
const root = path.resolve("test-output/recording-region-ui", `run-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const env = { ...process.env, FRAMECRAFT_SMOKE: "1", FRAMECRAFT_USER_DATA: path.join(root, "profile") };
delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.env.FRAMECRAFT_PACKAGED_SMOKE === "1";
const app = await electron.launch({
  ...(packaged ? { executablePath: path.resolve(process.env.FRAMECRAFT_PACKAGED_APP ?? "release/win-unpacked/TronCut.exe") } : {}),
  args: packaged ? [] : ["."], env,
});
const region = { x: 180, y: 240, width: 640, height: 360 };
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const fixture = await app.evaluate(async ({ BrowserWindow, screen }, region) => {
    const display = screen.getPrimaryDisplay();
    const physical = screen.dipToScreenRect(null, display.bounds);
    const sx = display.bounds.width / physical.width, sy = display.bounds.height / physical.height;
    const target = new BrowserWindow({ ...display.bounds, frame: false, backgroundColor: "#ff0000", skipTaskbar: true });
    await target.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<title>Recording region fixture</title><body style="margin:0;background:#f00"><div style="position:absolute;left:${region.x*sx}px;top:${region.y*sy}px;width:${region.width*sx}px;height:${region.height*sy}px;background:#0f0"></div><input aria-label="倒计时输入" style="position:absolute;left:10px;top:100px"><script>window.clicks=0;document.addEventListener('click',()=>window.clicks++)</script></body>`)}`);
    globalThis.regionFixture = target;
    return { id: target.id, handle: target.getNativeWindowHandle().readBigUInt64LE().toString(), bounds: display.bounds, physical, sx, sy };
  }, region);
  const targetPage = app.windows().find((p) => p.url().includes("Recording%20region%20fixture"));
  await page.getByRole("button", { name: "新建录制", exact: true }).click();
  await page.locator('.capture-sources > button[data-source-id^="screen:"]').first().click();
  await page.getByLabel("麦克风", { exact: true }).uncheck();
  await page.getByLabel("录制帧率", { exact: true }).selectOption("15");
  await selectPreview(page, "录屏背景", "none");
  const select = async () => {
    const opened = app.waitForEvent("window");
    await page.getByRole("button", { name: "自定义范围", exact: true }).click();
    const picker = await opened;
    await picker.waitForLoadState("load");
    await expect(picker.getByRole("button", { name: "使用此范围", exact: true })).toBeVisible();
    await expect(picker.locator("#width")).not.toHaveValue("");
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((w) => w.getTitle() === "TronCut 自定义录制范围");
      return !!w && w.isVisible();
    })).toBe(true);
    return picker;
  };
  let picker = await select();
  // Selection cancel preserves the previous screen/window choice.
  await picker.keyboard.press("Escape").catch((error) => { if (!picker.isClosed()) throw error; });
  await expect(page.getByLabel("自定义录制范围", { exact: true })).toHaveCount(0);
  picker = await select();
  // Redraw outside the default frame, resize a corner, then move the selection.
  await picker.mouse.move(25, 140);
  await picker.mouse.down();
  await picker.mouse.move(250, 320, { steps: 8 });
  await picker.mouse.up();
  const drawn = await picker.locator("#selection").boundingBox();
  expect(Math.abs(drawn.width - 225)).toBeLessThan(3);
  const corner = picker.locator('[data-edge="se"]');
  const cornerBounds = await corner.boundingBox();
  await picker.mouse.move(cornerBounds.x + cornerBounds.width / 2, cornerBounds.y + cornerBounds.height / 2);
  await picker.mouse.down();
  await picker.mouse.move(300, 350, { steps: 5 });
  await picker.mouse.up();
  expect((await picker.locator("#selection").boundingBox()).width).toBeGreaterThan(drawn.width);
  const moved = await picker.locator("#selection").boundingBox();
  await picker.mouse.move(moved.x + moved.width / 2, moved.y + moved.height / 2);
  await picker.mouse.down();
  await picker.mouse.move(moved.x + moved.width / 2 + 30, moved.y + moved.height / 2 + 20, { steps: 5 });
  await picker.mouse.up();
  expect((await picker.locator("#selection").boundingBox()).x).toBeGreaterThan(moved.x + 25);
  for (const [key, value] of Object.entries(region)) {
    await picker.locator(`#${key}`).fill(String(value));
    await picker.locator(`#${key}`).press("Tab");
  }
  await picker.screenshot({ path: path.join(root, "region-picker.png") });
  await picker.getByRole("button", { name: "使用此范围", exact: true }).click();
  await expect(page.getByLabel("自定义录制范围", { exact: true })).toContainText("640 × 360");
  await expect(page.locator(".capture-sources")).toHaveCount(0);
  await page.screenshot({ path: path.join(root, "region-settings.png") });
  // Existing selection is restored when reopening the selector.
  const reopened = app.waitForEvent("window");
  await page.getByRole("button", { name: "重新框选", exact: true }).click();
  picker = await reopened;
  await expect(picker.locator("#x")).toHaveValue(String(region.x));
  await expect(picker.locator("#width")).toHaveValue(String(region.width));
  await picker.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByLabel("自定义录制范围", { exact: true })).toContainText("640 × 360");

  for (const native of [true, false]) {
    if (!native) {
      await page.getByRole("button", { name: "录制", exact: true }).click();
      await expect(page.getByLabel("麦克风", { exact: true })).not.toBeChecked();
      await expect(page.locator(".capture-sources")).toBeVisible();
      const reopened = app.waitForEvent("window");
      await page.getByRole("button", { name: "自定义范围", exact: true }).click();
      picker = await reopened;
      for (const [key, value] of Object.entries(region)) {
        await picker.locator(`#${key}`).fill(String(value));
        await picker.locator(`#${key}`).press("Tab");
      }
      await picker.getByRole("button", { name: "使用此范围", exact: true }).click();
      await expect(page.locator(".capture-sources")).toHaveCount(0);
    }
    await page.getByLabel("原生录制与可编辑鼠标", { exact: true }).setChecked(native);
    await app.evaluate(() => {
      globalThis.regionFixture.setAlwaysOnTop(true, "screen-saver");
      globalThis.regionFixture.show();
      globalThis.regionFixture.moveTop();
      globalThis.regionFixture.focus();
    });
    const countdownOpened = app.waitForEvent("window");
    await page.getByRole("button", { name: "开始录制", exact: true }).click();
    const countdown = await countdownOpened;
    await expect(countdown.locator("strong")).toHaveText("3");
    const countdownWindow = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes(encodeURIComponent('aria-label="录制倒计时"')));
      return { bounds: w.getBounds(), focusable: w.isFocusable(), fullscreen: w.isFullScreen(), handle: w.getNativeWindowHandle().readBigUInt64LE().toString() };
    });
    expect(countdownWindow.focusable).toBe(false);
    expect(countdownWindow.fullscreen).toBe(false);
    expect(countdownWindow.bounds.width).toBeLessThan(260);
    const click = JSON.parse((await run("powershell.exe", ["-NoProfile", "-File", path.resolve("scripts/click-recording-overlay.ps1"), "-OverlayHandle", countdownWindow.handle], { windowsHide: true })).stdout.trim());
    expect(click.hitHandle).toBe(fixture.handle);
    expect(click.foreground).not.toBe(countdownWindow.handle);
    expect(await targetPage.evaluate(() => window.clicks)).toBeGreaterThan(0);
    // Typing into the underlying app still works while the indicator is up.
    await targetPage.getByLabel("倒计时输入").fill(`countdown-${native}`);
    await expect(targetPage.getByLabel("倒计时输入")).toHaveValue(`countdown-${native}`);
    const controls = await recordingControls(app);
    const inspection = JSON.parse((await run("powershell.exe", ["-NoProfile", "-File", path.resolve("scripts/inspect-recording-border.ps1")], { windowsHide: true })).stdout.trim());
    expect(inspection.bounds).toEqual({ left: fixture.physical.x + region.x, top: fixture.physical.y + region.y, right: fixture.physical.x + region.x + region.width, bottom: fixture.physical.y + region.y + region.height });
    await page.waitForTimeout(800);
    await controls.getByRole("button", { name: "暂停录制", exact: true }).click();
    await expect(controls.getByRole("status")).toHaveText("已暂停");
    await controls.getByRole("button", { name: "继续录制", exact: true }).click();
    await page.waitForTimeout(500);
    await controls.getByRole("button", { name: "停止录制", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("录制完成", { timeout: 45000 });
    await app.evaluate(() => globalThis.regionFixture.setAlwaysOnTop(false));
    await expect.poll(async () => (await page.evaluate(() => window.framecraft.readRecovery()))?.project.assets.filter((a) => a.kind === "video").length).toBe(native ? 1 : 2);
    const assets = (await page.evaluate(() => window.framecraft.readRecovery())).project.assets.filter((a) => a.kind === "video");
    const asset = assets.at(-1);
    expect(asset.width).toBe(region.width);
    expect(asset.height).toBe(region.height);
    for (const seconds of [0, 0.7]) {
      const frame = path.join(root, `${native ? "native" : "compatible"}-${seconds}.png`);
      await run(path.resolve("resources/bin/ffmpeg.exe"), ["-y", "-ss", String(seconds), "-i", asset.path, "-frames:v", "1", frame], { windowsHide: true });
      const { data, info } = await sharp(frame).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      let green = 0;
      for (let i = 0; i < data.length; i += info.channels) if (data[i] < 80 && data[i+1] > 180 && data[i+2] < 80) green++;
      expect(green / (info.width * info.height)).toBeGreaterThan(0.98);
    }
    if (native) {
      expect(asset.cursor.samples.length).toBeGreaterThan(0);
      expect(asset.cursor.samples.some((s) => !s.visible)).toBe(true);
    }
    console.log(JSON.stringify({ native, size: [asset.width, asset.height], duration: asset.duration, clickThrough: click }));
  }
  expect(errors).toEqual([]);
  console.log(`区域选择、拖动缩放、精确尺寸、原生/兼容裁切、范围边框及倒计时点击穿透通过：${root}`);
} finally { await app.close(); }
