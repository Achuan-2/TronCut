import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { selectPreview } from "./preview-select.mjs";

const root = path.resolve("test-output/editing-ui", `run-${Date.now()}`);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
const image = path.join(root, "粘贴图片.png");
const video = path.join(root, "粘贴视频.mp4");
await sharp({
  create: { width: 100, height: 80, channels: 3, background: "#76e5b5" },
})
  .png()
  .toFile(image);
await promisify(execFile)(
  path.resolve(
    "resources/bin",
    process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
  ),
  [
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=320x180:r=15",
    "-t",
    "4",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-y",
    video,
  ],
  { windowsHide: true },
);
const project = {
  format: "troncut",
  version: 1,
  id: "editing-ui",
  name: "界面测试",
  canvas: { width: 1920, height: 1080, fps: 30, background: "#151719" },
  assets: [
    {
      id: "recording",
      name: "录屏",
      path: video,
      kind: "video",
      duration: 4,
      width: 320,
      height: 180,
      hasAudio: false,
      cursor: {
        samples: [{ time: 0, x: 10, y: 20, visible: true, click: false }],
      },
    },
  ],
  tracks: Array.from({ length: 14 }, (_, index) => ({
    id: `track-${index}`,
    name: `轨道 ${index + 1}`,
    kind: "visual",
    hidden: false,
    muted: false,
    locked: false,
  })),
  clips: [
    {
      id: "recorded-clip",
      trackId: "track-0",
      assetId: "recording",
      kind: "video",
      name: "录屏",
      start: 0,
      duration: 1,
      sourceIn: 0,
      speed: 1,
      volume: 1,
      podcast: false,
      transform: { x: 0.5, y: 0.5, scale: 1, opacity: 1 },
      keyframes: [],
    },
  ],
  markers: [],
};
await fs.writeFile(
  path.join(profile, "recovery.json"),
  JSON.stringify({ project, file: null }),
);
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: profile,
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
  timeout: 30000,
});
// Compare actual handle centers with the rendered selection border, in screen pixels.
async function expectHandlesOnBorder(layer) {
  const offsets = await layer.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const border = getComputedStyle(element, "::after");
    const scaleX = bounds.width / element.offsetWidth;
    const scaleY = bounds.height / element.offsetHeight;
    const left = bounds.left + (parseFloat(border.left) + parseFloat(border.borderLeftWidth) / 2) * scaleX;
    const right = bounds.right - (parseFloat(border.right) + parseFloat(border.borderRightWidth) / 2) * scaleX;
    const top = bounds.top + (parseFloat(border.top) + parseFloat(border.borderTopWidth) / 2) * scaleY;
    const bottom = bounds.bottom - (parseFloat(border.bottom) + parseFloat(border.borderBottomWidth) / 2) * scaleY;
    return [...element.querySelectorAll(".resize-handle")].map((handle) => {
      const rect = handle.getBoundingClientRect();
      const direction = handle.classList.item(handle.classList.length - 1);
      const x = direction.includes("w") ? left : direction.includes("e") ? right : (left + right) / 2;
      const y = direction.includes("n") ? top : direction.includes("s") ? bottom : (top + bottom) / 2;
      return { direction, x: Math.abs(rect.x + rect.width / 2 - x), y: Math.abs(rect.y + rect.height / 2 - y) };
    });
  });
  expect(offsets).toHaveLength(8);
  for (const offset of offsets) {
    expect(offset.x, `${offset.direction} 水平中心偏差`).toBeLessThan(0.6);
    expect(offset.y, `${offset.direction} 垂直中心偏差`).toBeLessThan(0.6);
  }
}
try {
  const page = await app.firstWindow();
  await expect(page.locator(".home-page")).toBeVisible();
  await page.getByRole("button", { name: "恢复编辑", exact: true }).click();
  if (packaged) {
    const builtHtml = await fs.readFile(path.resolve("dist/index.html"), "utf8");
    const script = builtHtml.match(/src="([^"]+\.js)"/)?.[1];
    expect(script).toBeTruthy();
    await expect(page.locator('script[type="module"]')).toHaveAttribute("src", script);
  }
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.locator(".track-header")).toHaveCount(14);
  expect(await page.locator(".track-name").allTextContents()).toEqual(
    Array.from({ length: 14 }, (_, index) => `轨道${14 - index}`),
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1280, 900),
  );
  const toolbar = await page.locator(".app-header").boundingBox();
  expect(toolbar.height).toBe(44);
  expect((await page.locator(".editor-workspace").boundingBox()).y).toBe(44);
  await expect(page.locator(".workspace-bar")).toHaveCount(0);
  const chrome = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    return {
      menuVisible: window.isMenuBarVisible(),
      bounds: window.getBounds(),
      content: window.getContentBounds(),
    };
  });
  expect(chrome.menuVisible).toBe(false);
  expect(chrome.bounds.height - chrome.content.height).toBeLessThanOrEqual(2);
  expect(
    await page
      .locator(".app-header")
      .evaluate((element) =>
        getComputedStyle(element).getPropertyValue("-webkit-app-region"),
      ),
  ).toBe("drag");
  expect(
    await page
      .getByLabel("关闭窗口", { exact: true })
      .evaluate((element) =>
        getComputedStyle(element).getPropertyValue("-webkit-app-region"),
      ),
  ).toBe("no-drag");
  await page.getByRole("button", { name: "最大化", exact: true }).click();
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isMaximized(),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "还原窗口", exact: true }).click();
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isMaximized(),
      ),
    )
    .toBe(false);
  await page.getByRole("button", { name: "最小化", exact: true }).click();
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isMinimized(),
      ),
    )
    .toBe(true);
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.restore();
    window.focus();
  });
  await page.getByRole("button", { name: "工程", exact: true }).click();
  await expect(page.locator(".project-menu")).toBeVisible();
  await page.getByRole("button", { name: "工程", exact: true }).click();
  await app.evaluate(({ Menu }) => {
    globalThis.windowMenuRequests = [];
    for (const label of ["编辑", "视图"])
      Menu.getApplicationMenu().items.find(
        (item) => item.label === label,
      ).submenu.popup = ({ x, y }) =>
        globalThis.windowMenuRequests.push({ label, x, y });
  });
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByRole("button", { name: "视图", exact: true }).click();
  const menus = await app.evaluate(() => globalThis.windowMenuRequests);
  expect(menus.map((menu) => menu.label)).toEqual(["编辑", "视图"]);
  expect(menus.every((menu) => menu.y <= 44)).toBe(true);
  expect(
    await page.getByLabel("关闭窗口", { exact: true }).evaluate((button) => {
      const overlay = document.createElement("div");
      overlay.className = "busy-overlay";
      document.body.append(overlay);
      const bounds = button.getBoundingClientRect();
      const hit = document.elementFromPoint(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
      );
      overlay.remove();
      return button.contains(hit);
    }),
  ).toBe(true);
  await page.locator(".timeline-clip.video").click();
  const playbackButtons = page.locator(".playback-buttons");
  await expect(playbackButtons.locator("button")).toHaveCount(5);
  expect(await playbackButtons.locator("button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label") ?? button.title))).toEqual([
    "前一帧", "后一帧", "播放 / 暂停（空格）", "前一个媒体", "后一个媒体",
  ]);
  await expect(page.getByRole("button", { name: "前一帧", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "后一帧", exact: true }).click();
  await expect(page.locator(".timecode")).toContainText("00:00.03");
  await page.getByRole("button", { name: "前一帧", exact: true }).click();
  await expect(page.locator(".timecode")).toContainText("00:00.00");
  await page.getByRole("button", { name: "后一个媒体", exact: true }).click();
  await expect(page.locator(".timecode")).toContainText("00:01.00");
  await expect(page.getByRole("button", { name: "后一帧", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "前一个媒体", exact: true }).click();
  await expect(page.locator(".timecode")).toContainText("00:00.00");
  await page.locator(".play-button").click();
  await expect(page.locator(".play-button .lucide-pause")).toHaveCount(1);
  await page.getByRole("button", { name: "前一个媒体", exact: true }).click();
  await expect(page.locator(".play-button .lucide-play")).toHaveCount(1);
  await expect(page.locator(".timecode")).toContainText("00:00.00");
  await page.getByRole("slider", { name: "播放进度", exact: true }).focus();
  await page.keyboard.press("End");
  await expect(page.locator(".timecode")).toContainText("00:01.00");
  await page.keyboard.press("Home");
  await expect(page.locator(".timecode")).toContainText("00:00.00");
  await page.locator(".playback").click({ position: { x: 2, y: 2 } });
  await page.keyboard.press("Control+ArrowRight");
  await expect(page.locator(".timecode")).toContainText("00:01.00");
  await page.keyboard.press("Control+ArrowLeft");
  await expect(page.locator(".timecode")).toContainText("00:00.00");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".timecode")).toContainText("00:00.03");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".timecode")).toContainText("00:00.00");
  await page.screenshot({ path: path.join(root, "playback-controls.png") });
  console.log("播放条逐帧、前后媒体、快捷键、进度滑条和定位暂停通过");
  await page.getByLabel("画布显示比例", { exact: true }).selectOption("2");
  await page.getByRole("button", { name: "全屏预览", exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === document.querySelector(".preview-panel"))).toBe(true);
  await expect(page.locator(".canvas")).toBeVisible();
  await expect(page.getByRole("button", { name: "退出全屏预览", exact: true })).toBeVisible();
  const fullscreenCanvas = await page.locator(".canvas").boundingBox();
  const fullscreenViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  expect(fullscreenCanvas.width).toBeGreaterThan(600);
  expect(fullscreenCanvas.x).toBeGreaterThanOrEqual(0);
  expect(fullscreenCanvas.y).toBeGreaterThanOrEqual(0);
  expect(fullscreenCanvas.x + fullscreenCanvas.width).toBeLessThanOrEqual(fullscreenViewport.width + 1);
  expect(fullscreenCanvas.y + fullscreenCanvas.height).toBeLessThanOrEqual(fullscreenViewport.height + 1);
  await page.screenshot({ path: path.join(root, "fullscreen-preview.png") });
  await page.getByRole("button", { name: "退出全屏预览", exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await expect(page.getByLabel("画布显示比例", { exact: true })).toHaveValue("2");
  await expect(page.locator(".canvas")).toHaveCSS("width", "3840px");
  await page.getByLabel("画布显示比例", { exact: true }).selectOption("fit");
  await page.getByRole("button", { name: "全屏预览", exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
  await page.getByRole("button", { name: "退出全屏预览", exact: true }).press("Escape");
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  console.log("全屏画布显示、自适应、播放控制、按钮退出及 Esc 退出通过");
  await expect(page.getByRole("button", { name: "波纹删除", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "删除选项", exact: true }).click();
  await expect(page.getByRole("menu", { name: "删除菜单", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /^删除\s*Delete$/ })).toBeVisible();
  await page.getByRole("menuitem", { name: /^波纹删除/ }).click();
  await expect(page.locator(".timeline-clip")).toHaveCount(0);
  for (const name of ["前一帧", "后一帧", "前一个媒体", "后一个媒体"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
  }
  await expect(page.getByRole("slider", { name: "播放进度", exact: true })).toBeDisabled();
  await expect(page.getByRole("menu", { name: "删除菜单", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "添加关键帧", exact: true })).toBeDisabled();
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(page.locator(".timeline-clip.video")).toHaveCount(1);
  await page.locator(".timeline-clip.video").click();
  await expect(
    page.getByRole("tab", { name: "视频", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("鼠标样式")).toBeHidden();
  await page.getByRole("tab", { name: "鼠标", exact: true }).click();
  await selectPreview(page, "鼠标样式", "circle");
  await page.getByLabel("鼠标大小").fill("48");
  await expect(page.getByLabel("位置 X (px)")).toBeHidden();
  await page.getByRole("tab", { name: "视频", exact: true }).click();
  await expect(page.getByLabel("位置 X (px)")).toBeVisible();
  await page.getByRole("tab", { name: "鼠标", exact: true }).click();
  await expect(page.getByLabel("鼠标样式")).toHaveAttribute("data-value", "circle");
  await expect(page.getByLabel("鼠标大小")).toHaveValue("48");
  await page.getByRole("tab", { name: "视频", exact: true }).click();
  const canvasVideo = page.locator(".preview-panel .preview-layer.video");
  const videoViewport = canvasVideo.locator(".preview-effect-content > div").first();
  await expect(page.getByLabel("效果预设", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("裁切左侧 (%)", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("淡入 (秒)", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("淡出 (秒)", { exact: true })).toHaveCount(0);
  await expect(page.locator(".inspector .keyframe-list")).toHaveCount(0);
  await expect(page.getByLabel("开始 (秒)", { exact: true })).toBeHidden();
  await page.getByLabel("宽度 (px)", { exact: true }).fill("960");
  await expect(page.getByLabel("缩放 (%)", { exact: true })).toHaveValue("50");
  const scaleSlider = page.getByRole("slider", { name: "缩放滑条", exact: true });
  await scaleSlider.focus(); await page.keyboard.press("ArrowRight");
  await expect(page.getByLabel("缩放 (%)", { exact: true })).toHaveValue("50.1");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByLabel("缩放 (%)", { exact: true })).toHaveValue("50");
  await expect(page.getByLabel("高度 (px)", { exact: true })).toHaveValue("540");
  await page.getByLabel("水平翻转", { exact: true }).check();
  await page.getByLabel("垂直翻转", { exact: true }).check();
  await expect(videoViewport).toHaveCSS("transform", "matrix(-1, 0, 0, -1, 0, 0)");
  await page.getByLabel("水平翻转", { exact: true }).uncheck();
  await page.getByLabel("垂直翻转", { exact: true }).uncheck();
  await page.getByLabel("缩放 (%)", { exact: true }).fill("50");
  const videoHandle = canvasVideo.locator(".resize-handle.se");
  await expectHandlesOnBorder(canvasVideo);
  await videoHandle.hover();
  const videoBefore = await canvasVideo.boundingBox();
  const videoHandleBounds = await videoHandle.boundingBox();
  const videoX = videoHandleBounds.x + videoHandleBounds.width / 2,
    videoY = videoHandleBounds.y + videoHandleBounds.height / 2;
  await page.mouse.move(videoX, videoY);
  await page.mouse.down();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.mouse.move(videoX + 36, videoY + 20, { steps: 1 });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.mouse.up();
  await expect.poll(async () => (await canvasVideo.boundingBox()).width).toBeGreaterThan(videoBefore.width);
  const videoAfter = await canvasVideo.boundingBox();
  expect(videoAfter.width).toBeGreaterThan(videoBefore.width);
  expect(videoAfter.width / videoAfter.height).toBeCloseTo(16 / 9, 2);

  // View zoom must not change media transforms or the project resolution.
  // Canvas drags preserve focus; read the committed scale after leaving its
  // number input, rather than the draft kept for an unfinished text edit.
  await page.getByLabel("缩放 (%)", { exact: true }).blur();
  const viewZoom = page.getByLabel("画布显示比例", { exact: true });
  const mediaScale = await page.getByLabel("缩放 (%)", { exact: true }).inputValue();
  const fittedWidth = (await page.locator(".canvas").boundingBox()).width;
  await viewZoom.selectOption("1");
  await expect(page.locator(".canvas")).toHaveCSS("width", "1920px");
  expect(await page.locator(".canvas-holder").evaluate((element) => element.scrollWidth > element.clientWidth && element.scrollLeft > 0)).toBe(true);
  await viewZoom.selectOption("20");
  await expect(page.locator(".canvas")).toHaveCSS("width", "38400px");
  await viewZoom.selectOption("fit");
  await expect.poll(async () => (await page.locator(".canvas").boundingBox()).width).toBeCloseTo(fittedWidth, 0);
  await expect(page.getByLabel("缩放 (%)", { exact: true })).toHaveValue(mediaScale);

  // With automatic animation off, crop edits keep their existing static behavior.
  await page.getByRole("button", { name: "裁剪模式", exact: true }).click();
  await expect(page.getByRole("button", { name: "裁剪模式", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(canvasVideo.locator(".crop-handle")).toHaveCount(8);
  const cropBefore = await canvasVideo.boundingBox();
  const cropHandle = await canvasVideo.locator(".crop-handle.w").boundingBox();
  await page.mouse.move(cropHandle.x + cropHandle.width / 2, cropHandle.y + cropHandle.height / 2);
  await page.mouse.down();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.mouse.move(cropHandle.x + cropHandle.width / 2 + 20, cropHandle.y + cropHandle.height / 2, { steps: 4 });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.mouse.up();
  await expect.poll(async () => (await canvasVideo.boundingBox()).width).toBeLessThan(cropBefore.width - 15);
  const cropAfter = await canvasVideo.boundingBox();
  expect(cropAfter.x + cropAfter.width).toBeCloseTo(cropBefore.x + cropBefore.width, 0);
  expect(cropAfter.height).toBeCloseTo(cropBefore.height, 0);
  await expect(page.getByLabel("缩放 (%)", { exact: true })).toHaveValue("100");
  await expect(page.locator(".timeline-clip.video .clip-animation")).toHaveCount(0);
  await page.screenshot({ path: path.join(root, "canvas-crop.png") });
  await page.getByRole("button", { name: "恢复裁剪", exact: true }).click();
  await expect.poll(async () => (await canvasVideo.boundingBox()).width).toBeCloseTo(cropBefore.width, 0);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect.poll(async () => (await canvasVideo.boundingBox()).width).toBeCloseTo(cropAfter.width, 0);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  // In crop mode, scale/pan the source inside the unchanged visible rectangle.
  const fixedVideo = await canvasVideo.boundingBox();
  const innerVideo = videoViewport.locator(":scope > div").first();
  const sourceWidth = Number(await innerVideo.evaluate((element) => element.style.width.slice(0, -2)));
  await page.getByLabel("缩放 (%)", { exact: true }).fill("200");
  await expect(page.getByRole("slider", { name: "缩放滑条", exact: true })).toHaveValue("200");
  await expect.poll(async () => Number(await innerVideo.evaluate((element) => element.style.width.slice(0, -2)))).toBeCloseTo(sourceWidth * 2, 0);
  await expect(page.getByLabel("宽度 (px)", { exact: true })).toBeDisabled();
  await page.mouse.move(fixedVideo.x + fixedVideo.width / 2, fixedVideo.y + fixedVideo.height / 2);
  await page.mouse.down();
  await page.mouse.move(fixedVideo.x + fixedVideo.width / 2 + 18, fixedVideo.y + fixedVideo.height / 2 - 12, { steps: 4 });
  await page.mouse.up();
  const pannedVideo = await canvasVideo.boundingBox();
  for (const key of ["x", "y", "width", "height"]) expect(pannedVideo[key]).toBeCloseTo(fixedVideo[key], 0);
  await expect.poll(async () => Number(await page.getByLabel("内容位置 X (%)", { exact: true }).inputValue())).toBeGreaterThan(0);
  await expect.poll(async () => Number(await page.getByLabel("内容位置 Y (%)", { exact: true }).inputValue())).toBeLessThan(0);
  await expect(page.locator(".timeline-clip.video .clip-animation")).toHaveCount(0);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(page.getByLabel("内容位置 X (%)", { exact: true })).toHaveValue("0");
  await page.getByTitle("重做 Ctrl+Shift+Z", { exact: true }).click();
  await expect.poll(async () => Number(await page.getByLabel("内容位置 X (%)", { exact: true }).inputValue())).toBeGreaterThan(0);
  const savedVideoContent = { scale: 2,
    x: Number(await page.getByLabel("内容位置 X (%)", { exact: true }).inputValue()) / 100,
    y: Number(await page.getByLabel("内容位置 Y (%)", { exact: true }).inputValue()) / 100 };
  expect(savedVideoContent.x).toBeGreaterThan(0);
  await page.screenshot({ path: path.join(root, "fixed-crop-content.png") });
  await page.getByRole("button", { name: "选择模式", exact: true }).click();
  await expect(canvasVideo.locator(".crop-handle")).toHaveCount(0);
  await expect(page.getByLabel("缩放 (%)", { exact: true })).toHaveValue(mediaScale);
  expect(Number(await page.getByRole("slider", { name: "缩放滑条", exact: true }).inputValue())).toBeCloseTo(Number(mediaScale), 1);
  for (const axis of ["X", "Y", "Z"]) await expect(page.getByLabel(`旋转 ${axis} (度)`, { exact: true })).toBeVisible();
  const axisBefore = await canvasVideo.boundingBox();
  await page.getByLabel("旋转 X (度)", { exact: true }).fill("60");
  await expect.poll(async () => (await canvasVideo.boundingBox()).height).toBeCloseTo(axisBefore.height / 2, 0);
  await page.getByLabel("旋转 X (度)", { exact: true }).fill("0");
  await page.getByLabel("旋转 Y (度)", { exact: true }).fill("60");
  await expect.poll(async () => (await canvasVideo.boundingBox()).width).toBeCloseTo(axisBefore.width / 2, 0);
  const yDial = page.getByRole("button", { name: "旋转 Y 拨盘", exact: true });
  await yDial.scrollIntoViewIfNeeded();
  const dialBounds = await yDial.boundingBox(), dialX = dialBounds.x + dialBounds.width / 2, dialY = dialBounds.y + dialBounds.height / 2;
  await page.mouse.move(dialX, dialY - 10); await page.mouse.down();
  await page.mouse.move(dialX + 10, dialY, { steps: 4 }); await page.mouse.up();
  await expect.poll(async () => Number(await page.getByLabel("旋转 Y (度)", { exact: true }).inputValue())).toBeCloseTo(150, 0);
  await yDial.dblclick();
  await expect(page.getByLabel("旋转 Y (度)", { exact: true })).toHaveValue("0");
  const zDial = page.getByRole("button", { name: "旋转 Z 拨盘", exact: true });
  await zDial.focus(); await page.keyboard.press("ArrowRight");
  await expect(page.getByLabel("旋转 Z (度)", { exact: true })).toHaveValue("1");
  await page.keyboard.press("Home");
  await expect(page.getByLabel("旋转 Z (度)", { exact: true })).toHaveValue("0");
  await page.screenshot({ path: path.join(root, "scale-rotation-controls.png") });

  await page.getByRole("button", { name: "画布大小设置", exact: true }).click();
  const canvasSettings = page.getByRole("dialog", { name: "画布大小设置", exact: true });
  await expect(canvasSettings).toBeVisible();
  await canvasSettings.getByLabel("宽度（像素）", { exact: true }).fill("0");
  await canvasSettings.getByRole("button", { name: "应用", exact: true }).click();
  await expect(canvasSettings).toBeVisible();
  await canvasSettings.getByLabel("预设尺寸", { exact: true }).selectOption("1");
  await expect(canvasSettings.getByLabel("高度（像素）", { exact: true })).toHaveValue("1920");
  await page.screenshot({ path: path.join(root, "canvas-settings.png") });
  await canvasSettings.getByRole("button", { name: "应用", exact: true }).click();
  await expect(canvasSettings).toHaveCount(0);
  await expect(page.getByRole("button", { name: "画布大小设置", exact: true })).toContainText("1080 × 1920");
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(page.getByRole("button", { name: "画布大小设置", exact: true })).toContainText("1920 × 1080");
  await viewZoom.selectOption("settings");
  await expect(canvasSettings).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(canvasSettings).toHaveCount(0);
  await expect(viewZoom).toHaveValue("fit");
  console.log("画布顶部模式切换、显示缩放/滚动、视频裁剪与恢复/撤销、画布预设及输入校验通过");

  const rulerBefore = await page.locator(".ruler").boundingBox();
  const labelBefore = await page.locator(".ruler-label").boundingBox();
  await page.locator(".timeline-scroll").evaluate((element) => {
    element.scrollTop = 250;
    element.scrollLeft = 130;
  });
  await expect
    .poll(() =>
      page.locator(".track-headers").evaluate((element) => element.scrollTop),
    )
    .toBe(250);
  const rulerAfter = await page.locator(".ruler").boundingBox();
  const labelAfter = await page.locator(".ruler-label").boundingBox();
  expect(rulerAfter.y).toBe(rulerBefore.y);
  expect(labelAfter.y).toBe(labelBefore.y);
  expect(
    await page.locator(".ruler").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return !!document
        .elementFromPoint(Math.max(180, rect.left + 200), rect.top + 10)
        ?.closest(".ruler");
    }),
  ).toBe(true);
  const header = await page.locator(".track-header").nth(5).boundingBox();
  const lane = await page.locator(".track-lane").nth(5).boundingBox();
  expect(header.y).toBe(lane.y);
  await page.locator(".ruler").click({ position: { x: 260, y: 15 } });
  await expect(page.locator(".timecode")).toContainText("00:04.00");

  // Register real fixtures through the normal import route. Replace only clipboard
  // IPC for these UI checks, so the user's system clipboard remains untouched.
  await app.evaluate(
    ({ dialog, ipcMain }, files) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: files,
      });
      globalThis.editingClipboard = { assets: [], clipToken: null };
      ipcMain.removeHandler("clipboard:clips");
      ipcMain.handle("clipboard:clips", (_, token) => {
        globalThis.editingClipboard = { assets: [], clipToken: token };
      });
      ipcMain.removeHandler("media:clipboard");
      ipcMain.handle("media:clipboard", () => globalThis.editingClipboard);
    },
    [image, video],
  );
  const assets = await page.evaluate(() => window.framecraft.importMedia());
  await page.locator(".timeline-clip.video").click();
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await expect(page.locator(".timeline-clip.video")).toHaveCount(2);
  await app.evaluate((_, assets) => {
    globalThis.editingClipboard = { assets, clipToken: null };
  }, assets);
  await page.keyboard.press("Control+v");
  await expect(page.locator(".timeline-clip.video")).toHaveCount(3);
  await expect(page.locator(".timeline-clip.image")).toHaveCount(1);
  await expect(page.locator(".asset-card")).toHaveCount(3);
  await expect(page.locator(".track-header")).toHaveCount(16);
  await expect(page.locator(".track-name").first()).toHaveText("轨道16");
  expect(await page.locator(".timeline-clip.image").evaluate((element) =>
    element.closest(".track-lane").dataset.track,
  )).toBe(await page.locator(".track-lane").nth(1).getAttribute("data-track"));
  const originalImageTrack = await page.locator(".timeline-clip.image").evaluate((element) =>
    element.closest(".track-lane").dataset.track,
  );
  await app.evaluate((_, assets) => {
    globalThis.editingClipboard = { assets: assets.filter((asset) => asset.kind === "image"), clipToken: null };
  }, assets);
  await page.keyboard.press("Control+v");
  await expect(page.locator(".timeline-clip.image")).toHaveCount(2);
  await expect(page.locator(".track-header")).toHaveCount(17);
  const pastedImageTracks = await page.locator(".timeline-clip.image").evaluateAll((elements) =>
    elements.map((element) => element.closest(".track-lane").dataset.track),
  );
  expect(new Set(pastedImageTracks).size).toBe(2);
  expect(pastedImageTracks).toContain(originalImageTrack);
  await page.screenshot({ path: path.join(root, "pasted-image-tracks.png") });
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(page.locator(".timeline-clip.image")).toHaveCount(1);
  await expect(page.locator(".track-header")).toHaveCount(16);
  // Clipboard video now receives its own top track; hide that overlay while
  // exercising the image underneath, then restore it for the video checks.
  const overlayTrack = await page.locator(".track-lane").first().getAttribute("data-track");
  const toggleOverlay = async () => {
    const index = await page.locator(".track-lane").evaluateAll((lanes, id) => lanes.findIndex(lane => lane.dataset.track === id), overlayTrack);
    await page.locator(".track-header").nth(index).getByTitle("显示 / 隐藏轨道", { exact: true }).click({ force: true });
  };
  await toggleOverlay();
  await app.evaluate((_, assets) => {
    globalThis.editingClipboard = { assets, clipToken: null };
  }, assets);
  await page.locator(".timeline-clip.image").click();
  await expect(
    page.getByRole("tab", { name: "鼠标", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "片段", exact: true })).toHaveCount(0);
  const imageMove = await page.locator(".timeline-clip.image .clip-label").boundingBox();
  await page.mouse.move(imageMove.x + 20, imageMove.y + 10);
  await page.mouse.down();
  await page.mouse.move(imageMove.x + 150, imageMove.y + 10, { steps: 4 });
  await page.mouse.up();
  const positionInput = page.getByLabel("位置 X (px)", { exact: true });
  await positionInput.focus();
  await page.keyboard.press("Control+v");
  // Native paste may validly change a number input using the user's clipboard.
  // Restore the fixture position without modifying that clipboard.
  await positionInput.fill("0");
  await expect(page.locator(".timeline-clip.image")).toHaveCSS("left", "390px");
  await expect(page.locator(".timeline-clip.image")).toHaveCount(1);
  await page.getByRole("tab", { name: "画面", exact: true }).click();
  const seek = async (time) => {
    await page.locator(".timeline-scroll").evaluate((element) => {
      element.scrollLeft = 0;
    });
    await page.locator(".ruler").click({ position: { x: time * 65, y: 15 } });
  };
  await seek(7);
  const canvasImage = page.locator(".preview-panel .preview-layer.image");
  await canvasImage.click();
  await page.getByLabel("缩放 (%)", { exact: true }).fill("50");
  await expect(canvasImage.locator(".resize-handle")).toHaveCount(8);
  await expectHandlesOnBorder(canvasImage);
  const dragHandle = async (locator, dx, dy, steps = 5) => {
    await locator.hover();
    const bounds = await locator.boundingBox();
    const x = bounds.x + bounds.width / 2,
      y = bounds.y + bounds.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps });
    await page.mouse.up();
  };
  const uncroppedImage = await canvasImage.boundingBox();
  await page.getByRole("button", { name: "裁剪模式", exact: true }).click();
  await expectHandlesOnBorder(canvasImage);
  await dragHandle(canvasImage.locator(".crop-handle.s"), 0, -12);
  await expect.poll(async () => (await canvasImage.boundingBox()).height).toBeLessThan(uncroppedImage.height - 8);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await page.getByRole("button", { name: "选择模式", exact: true }).click();
  const beforeResize = await canvasImage.boundingBox();
  await dragHandle(canvasImage.locator(".resize-handle.se"), 40, 32);
  await expect.poll(async () => (await canvasImage.boundingBox()).width).toBeGreaterThan(beforeResize.width);
  const afterResize = await canvasImage.boundingBox();
  expect(afterResize.width).toBeGreaterThan(beforeResize.width);
  expect(afterResize.x).toBeCloseTo(beforeResize.x, 0);
  expect(afterResize.y).toBeCloseTo(beforeResize.y, 0);
  expect(afterResize.width / afterResize.height).toBeCloseTo(
    beforeResize.width / beforeResize.height,
    2,
  );
  const addKeyframe = page.getByRole("button", { name: "添加关键帧", exact: true });
  const beforeKeyframeX = await page.getByLabel("位置 X (px)", { exact: true }).inputValue();
  expect(await addKeyframe.evaluate((button) => button.previousElementSibling.textContent)).toContain("添加文本");
  await seek(8);
  await addKeyframe.click();
  await expect(page.locator(".timeline-clip.image .clip-animation")).toHaveCount(1);
  await expect(page.locator(".timeline-clip.image .animation-point.end")).toHaveClass(/selected-frame/);
  await page.getByLabel("位置 X (px)", { exact: true }).fill("80");
  await page.getByLabel("位置 X (px)", { exact: true }).blur();
  await seek(7);
  await expect(page.getByLabel("位置 X (px)", { exact: true })).toHaveValue(beforeKeyframeX);
  for (let i = 0; i < 2; i++) await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(page.locator(".timeline-clip.image .clip-animation")).toHaveCount(0);
  await page.getByRole("button", { name: "自动动画", exact: true }).click();
  await seek(8);
  await dragHandle(canvasImage.locator(".resize-handle.se"), 20, 16, 1);
  await expect(page.locator(".timeline-clip.image .clip-animation")).toHaveCount(1);
  const imageClip = page.locator(".timeline-clip.image");
  const imageArrow = imageClip.locator(".clip-animation");
  await expect(imageArrow).toHaveCount(1);
  await expect(imageClip.locator(".keyframe")).toHaveCount(0);
  const animationStart = Number(await imageArrow.getAttribute("data-start"));
  const animationEnd = Number(await imageArrow.getAttribute("data-end"));
  expect((await imageArrow.boundingBox()).width).toBeCloseTo((animationEnd - animationStart) * 65, 0);
  const imageClipLeft = (await imageClip.boundingBox()).x;
  await imageArrow.locator(".animation-point.start").click();
  await expect(imageArrow.locator(".animation-point.end")).not.toHaveClass(/active/);
  await expect(imageClip).toHaveClass(/selected/);
  await expect(page.getByLabel("位置 X (px)", { exact: true })).toBeVisible();
  await imageArrow.locator(".animation-point.end").click();
  await expect(imageArrow.locator(".animation-point.end")).toHaveClass(/active/);
  await expect(page.locator(".keyframe-edit-status")).toContainText("编辑动画终点");
  await page.getByRole("button", { name: "自动动画", exact: true }).click();
  await page.getByLabel("位置 X (px)", { exact: true }).fill("80");
  await page.getByLabel("位置 X (px)", { exact: true }).blur();
  await expect.poll(async () => (await imageArrow.locator(".animation-point.end").boundingBox()).width).toBeGreaterThan(17);
  await expect.poll(async () => (await imageArrow.locator(".animation-point.end").boundingBox()).width).toBeCloseTo(17, 1);
  await imageArrow.locator(".animation-point.start").click();
  await expect(imageArrow.locator(".animation-point.start")).toHaveAttribute("aria-pressed", "true");
  expect(await imageArrow.locator(".animation-point.start").evaluate((element) => getComputedStyle(element).cursor)).toContain("data:image/svg+xml");
  await page.getByLabel("位置 X (px)", { exact: true }).fill("20");
  await page.getByLabel("位置 X (px)", { exact: true }).blur();
  await imageArrow.locator(".animation-point.end").click();
  await expect(page.getByLabel("位置 X (px)", { exact: true })).toHaveValue("80");
  await page.screenshot({ path: path.join(root, "keyframe-end-edit.png") });
  await dragHandle(canvasImage, 12, 0, 1);
  expect(Number(await page.getByLabel("位置 X (px)", { exact: true }).inputValue())).toBeGreaterThan(80);
  await imageArrow.locator(".animation-point.start").click();
  await expect(page.getByLabel("位置 X (px)", { exact: true })).toHaveValue("20");
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await imageArrow.locator(".animation-point.end").click();
  await page.getByLabel("旋转 Z (度)", { exact: true }).fill("45");
  await page.getByLabel("旋转 Z (度)", { exact: true }).blur();
  await imageArrow.locator(".animation-point.start").click();
  await expect(page.getByLabel("旋转 Z (度)", { exact: true })).toHaveValue("0");
  await imageArrow.locator(".animation-point.end").click();
  await expect(page.getByLabel("旋转 Z (度)", { exact: true })).toHaveValue("45");
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await seek(7);
  await expect(page.locator(".keyframe-edit-status")).toHaveCount(0);
  expect(Number(await page.getByLabel("位置 X (px)", { exact: true }).inputValue())).toBeCloseTo(20, 1);
  for (let i = 0; i < 2; i++) await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await page.getByRole("button", { name: "自动动画", exact: true }).click();
  await imageArrow.locator(".animation-point.end").click();
  await dragHandle(imageClip.locator(".trim-handle.right"), -195, 0, 1);
  await expect(imageClip).toHaveCSS("width", "130px");
  await seek(7.5);
  await expect(canvasImage).toBeVisible();
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  expect((await imageClip.boundingBox()).x).toBeCloseTo(imageClipLeft, 0);
  await imageArrow.locator(".animation-arrow").click();
  await expect(imageArrow.locator(".animation-point.end")).toHaveClass(/active/);
  await dragHandle(imageArrow.locator(".animation-point.start"), 32.5, 0, 1);
  await expect.poll(async () => Number(await imageArrow.getAttribute("data-start"))).toBeCloseTo(animationStart + 0.5, 2);
  expect(Number(await imageArrow.getAttribute("data-end"))).toBeCloseTo(animationEnd, 2);
  await dragHandle(imageArrow.locator(".animation-point.end"), 32.5, 0, 1);
  await expect.poll(async () => Number(await imageArrow.getAttribute("data-end"))).toBeCloseTo(animationEnd + 0.5, 2);
  const animationWidth = (await imageArrow.boundingBox()).width;
  await dragHandle(imageArrow.locator(".animation-arrow"), 65, 0, 1);
  await expect.poll(async () => Number(await imageArrow.getAttribute("data-start"))).toBeCloseTo(animationStart + 1.5, 2);
  expect(Number(await imageArrow.getAttribute("data-end"))).toBeCloseTo(animationEnd + 1.5, 2);
  expect((await imageArrow.boundingBox()).width).toBeCloseTo(animationWidth, 0);
  expect((await imageClip.boundingBox()).x).toBeCloseTo(imageClipLeft, 0);
  for (let i = 0; i < 3; i++) await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect.poll(async () => Number(await imageArrow.getAttribute("data-start"))).toBeCloseTo(animationStart, 2);
  expect(Number(await imageArrow.getAttribute("data-end"))).toBeCloseTo(animationEnd, 2);
  await imageArrow.locator(".animation-point.end").click();
  await expect(imageArrow.locator(".animation-point.end")).toHaveClass(/active/);
  await page.screenshot({ path: path.join(root, "animation-arrows.png") });
  await expect.poll(async () => (await imageArrow.locator(".animation-point.end").boundingBox()).width).toBeCloseTo(17, 1);
  await seek(10);
  await expect.poll(async () => (await imageArrow.locator(".animation-point.end").boundingBox()).width).toBeCloseTo(10, 1);
  await page.getByLabel("位置 X (px)", { exact: true }).fill("65");
  await page.getByLabel("位置 X (px)", { exact: true }).blur();
  const separatedArrows = imageClip.locator(".clip-animation");
  await expect(separatedArrows).toHaveCount(2);
  expect(Number(await separatedArrows.nth(1).getAttribute("data-start"))).toBeCloseTo(9, 2);
  expect(Number(await separatedArrows.nth(1).getAttribute("data-end"))).toBeCloseTo(10, 2);
  await separatedArrows.nth(1).locator(".animation-point.start").click();
  await expect(separatedArrows.nth(0).locator(".animation-point.end")).toHaveClass(/selected-frame/);
  await expect(separatedArrows.nth(1).locator(".animation-point.start")).not.toHaveClass(/selected-frame/);
  await page.getByLabel("位置 X (px)", { exact: true }).fill("70");
  await page.getByLabel("位置 X (px)", { exact: true }).blur();
  await seek(8.5);
  await expect(page.getByLabel("位置 X (px)", { exact: true })).toHaveValue("70");
  await expect(separatedArrows).toHaveCount(2);
  await separatedArrows.nth(0).locator(".animation-point.start").click();
  await page.getByLabel("位置 X (px)", { exact: true }).fill("20");
  await page.getByLabel("位置 X (px)", { exact: true }).blur();
  await seek(6.5);
  await expect(page.getByLabel("位置 X (px)", { exact: true })).toHaveValue("20");
  await expect(separatedArrows).toHaveCount(2);
  await page.screenshot({ path: path.join(root, "separated-animation-arrows.png") });
  for (let i = 0; i < 3; i++) await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(imageArrow).toHaveCount(1);
  await imageArrow.locator(".animation-point.end").click();
  await expect(imageArrow).toHaveClass(/selected-animation/);
  await expect(imageArrow.locator(".animation-arrow svg")).toHaveCSS("stroke", "rgb(255, 212, 91)");
  const openAnimationMenu = async (arrow) => {
    await arrow.locator(".animation-arrow").click({ button: "right" });
    await expect(page.getByRole("menu", { name: "动画菜单", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "删除片段", exact: true })).toHaveCount(0);
  };
  for (const label of ["指数缓入/缓出", "线性", "跳跃", "回弹", "自动"]) {
    await openAnimationMenu(imageArrow);
    await page.getByRole("menuitem", { name: "启用缓冲", exact: true })
      .press("ArrowRight");
    await page.getByRole("menuitemradio", { name: label, exact: true }).click();
    await openAnimationMenu(imageArrow);
    await page.getByRole("menuitem", { name: "启用缓冲", exact: true })
      .press("ArrowRight");
    await expect(page.getByRole("menuitemradio", { name: label, exact: true })).toHaveAttribute("aria-checked", "true");
    if (label === "回弹") await page.screenshot({ path: path.join(root, "animation-context-menu.png") });
    await page.keyboard.press("Escape");
  }
  for (let i = 0; i < 5; i++) await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await openAnimationMenu(imageArrow);
  await page.getByRole("menuitem", { name: "复制", exact: false }).click();
  await seek(9);
  await page.keyboard.press("Control+v");
  await expect(imageClip.locator(".clip-animation")).toHaveCount(2);
  await expect(page.locator(".timeline-clip.image")).toHaveCount(1);
  const pastedArrow = imageClip.locator(".clip-animation").nth(1);
  expect(Number(await pastedArrow.getAttribute("data-start"))).toBeCloseTo(9, 2);
  expect(Number(await pastedArrow.getAttribute("data-end"))).toBeCloseTo(10, 2);
  await openAnimationMenu(pastedArrow);
  await page.getByRole("menuitem", { name: "删除", exact: false }).click();
  await expect(imageClip.locator(".clip-animation")).toHaveCount(1);
  await expect(page.locator(".timeline-clip.image")).toHaveCount(1);
  for (let i = 0; i < 2; i++) await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await openAnimationMenu(imageArrow);
  await page.getByRole("menuitem", { name: "剪切", exact: false }).click();
  await expect(imageClip.locator(".clip-animation")).toHaveCount(0);
  await expect(page.locator(".timeline-clip.image")).toHaveCount(1);
  await seek(animationStart);
  await page.keyboard.press("Control+v");
  await expect(imageArrow).toHaveCount(1);
  expect(Number(await imageArrow.getAttribute("data-start"))).toBeCloseTo(animationStart, 2);
  expect(Number(await imageArrow.getAttribute("data-end"))).toBeCloseTo(animationEnd, 2);
  for (let i = 0; i < 2; i++) await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await imageClip.click({ button: "right", position: { x: 20, y: 10 } });
  for (const label of ["添加淡入动画", "添加缩放动画", "添加滑入动画"]) {
    await expect(page.getByRole("button", { name: label, exact: true })).toHaveCount(0);
  }
  await seek(animationEnd);
  await imageArrow.locator(".animation-point.end").click();
  await page.keyboard.press("Control+c");
  await seek(9);
  await page.keyboard.press("Control+v");
  await expect(imageClip.locator(".clip-animation")).toHaveCount(2);
  await page.keyboard.press("Delete");
  await expect(imageClip.locator(".clip-animation")).toHaveCount(1);
  await expect(page.locator(".timeline-clip.image")).toHaveCount(1);
  for (let i = 0; i < 2; i++) await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await imageArrow.locator(".animation-point.end").click();
  const trackLock = async (clip) => {
    await page.locator(".timeline-scroll").evaluate((element) => {
      element.scrollTop = 0;
    });
    const index = await clip.evaluate((element) =>
      [...document.querySelectorAll(".track-lane")].indexOf(
        element.closest(".track-lane"),
      ),
    );
    return page
      .locator(".track-header")
      .nth(index)
      .getByTitle("锁定 / 解锁轨道", { exact: true });
  };
  const imageLock = await trackLock(page.locator(".timeline-clip.image"));
  await imageLock.click();
  await expect(canvasImage.locator(".resize-handle")).toHaveCount(0);
  await expect(scaleSlider).toBeDisabled();
  await expect(page.getByRole("button", { name: "旋转 X 拨盘", exact: true })).toBeDisabled();
  await expect(addKeyframe).toBeDisabled();
  await openAnimationMenu(imageArrow);
  await expect(page.getByRole("menuitem", { name: "剪切", exact: false })).toBeDisabled();
  await expect(page.getByRole("menuitem", { name: "删除", exact: false })).toBeDisabled();
  await expect(page.getByRole("menuitem", { name: "启用缓冲", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await dragHandle(imageArrow.locator(".animation-arrow"), 65, 0, 1);
  expect(Number(await imageArrow.getAttribute("data-start"))).toBeCloseTo(animationStart, 2);
  expect(Number(await imageArrow.getAttribute("data-end"))).toBeCloseTo(animationEnd, 2);
  await imageLock.click();

  await page.getByRole("button", { name: "添加文本", exact: true }).click();
  const canvasText = page.locator(".preview-panel .preview-layer.text");
  const textBackground = page.getByRole("switch", { name: "启用背景色", exact: true });
  await expect(textBackground).not.toBeChecked();
  await expect(canvasText.locator(".preview-text-fill")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await textBackground.check();
  await expect(canvasText.locator(".preview-text-fill")).toHaveCSS("background-color", "rgba(0, 0, 0, 0.75)");
  await textBackground.uncheck();
  await expect(canvasText.locator(".preview-text-fill")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await canvasText.dblclick();
  const textEditor = page.getByLabel("画布文本内容", { exact: true });
  await expect(textEditor).toBeFocused();
  await textEditor.fill("中文第一行\n第二行");
  await textEditor.press("Space");
  await expect(page.getByLabel("文本内容", { exact: true })).toHaveValue(
    "中文第一行\n第二行 ",
  );
  await expect(page.locator(".play-button .lucide-play")).toHaveCount(1);
  await textEditor.press("Backspace");
  await textEditor.press("Enter");
  await page.keyboard.insertText("第三行");
  await textEditor.press("Control+Enter");
  await expect(textEditor).toHaveCount(0);
  await expect(page.getByLabel("文本内容", { exact: true })).toHaveValue(
    "中文第一行\n第二行\n第三行",
  );
  const textLock = await trackLock(page.locator(".timeline-clip.text"));
  await textLock.click();
  await canvasText.dblclick();
  await expect(textEditor).toHaveCount(0);
  await textLock.click();
  await page.locator(".timeline-clip.text").dblclick();
  await expect(textEditor).toBeFocused();
  await textEditor.fill("撤销测试");
  await textEditor.press("Escape");
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(page.getByLabel("文本内容", { exact: true })).toHaveValue(
    "中文第一行\n第二行\n第三行",
  );

  await page.getByRole("button", { name: "自动动画", exact: true }).click();
  const textTab = page.getByRole("tab", { name: "文本", exact: true });
  const pictureTab = page.getByRole("tab", { name: "画面", exact: true });
  await expect(textTab).toHaveAttribute("aria-selected", "true");
  await pictureTab.click();
  await expect(page.getByLabel("文本内容", { exact: true })).toBeHidden();
  await expect(page.getByLabel("位置 X (px)", { exact: true })).toBeVisible();
  await pictureTab.press("ArrowRight");
  await expect(textTab).toBeFocused();
  const autoText = page.getByLabel("自动调整文本大小", { exact: true });
  const fontSize = page.getByLabel("字号", { exact: true });
  await expect(autoText).not.toBeChecked();
  await fontSize.fill("50");
  await expect(canvasText.locator(".resize-handle")).toHaveCount(8);
  await expectHandlesOnBorder(canvasText);
  const beforeTextResize = await canvasText.boundingBox();
  await dragHandle(canvasText.locator(".resize-handle.e"), 40, 0);
  await expect.poll(async () => (await canvasText.boundingBox()).width)
    .toBeGreaterThan(beforeTextResize.width + 35);
  await expect(fontSize).toHaveValue("50");
  expect((await canvasText.boundingBox()).height).toBeCloseTo(beforeTextResize.height, 0);
  await autoText.check();
  await expect(fontSize).toBeDisabled();
  const initialFitFont = Number(await fontSize.inputValue());
  const beforeFit = await canvasText.boundingBox();
  await dragHandle(canvasText.locator(".resize-handle.se"), 30, 30, 1);
  await expect.poll(async () => Number(await fontSize.inputValue())).toBeGreaterThan(initialFitFont);
  const savedTextFont = Number(await fontSize.inputValue());
  const afterFit = await canvasText.boundingBox();
  expect(afterFit.x).toBeCloseTo(beforeFit.x, 0);
  expect(afterFit.y).toBeCloseTo(beforeFit.y, 0);
  await page.getByLabel("文本内容", { exact: true }).fill("中文第一行变得更长一些\n第二行\n第三行");
  await expect.poll(async () => Number(await fontSize.inputValue())).toBeLessThan(savedTextFont);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  expect(Number(await fontSize.inputValue())).toBeCloseTo(savedTextFont, 2);
  await textLock.click();
  await expect(autoText).toBeDisabled();
  await expect(canvasText.locator(".resize-handle")).toHaveCount(0);
  await textLock.click();
  await page.screenshot({ path: path.join(root, "text-properties.png") });

  await toggleOverlay();
  for (let i = 0; i < 3; i++) {
    const clip = page.locator(".timeline-clip.video").nth(i);
    await clip.click();
    const width = (await clip.boundingBox()).width;
    if (width < 260) await dragHandle(clip.locator(".trim-handle.right"), 260 - width, 0, 1);
    const left = Number.parseFloat(await clip.evaluate(element => element.style.left));
    await dragHandle(clip, 390 - left, 0, 1);
    await expect(clip).toHaveCSS("left", "390px");
    await expect(clip).toHaveCSS("width", "260px");
  }
  await seek(8);
  // Switching inspector tabs selects its current clip; enter the desired tab
  // before selecting all clips for the batch-animation check.
  await page.locator(".timeline-clip.text").click();
  await page.getByRole("tab", { name: "画面", exact: true }).click();
  await page.locator(".timeline-toolbar").click({ position: { x: 2, y: 2 } });
  await page.keyboard.press("Control+a");
  await expect(page.locator(".timeline-clip.selected")).toHaveCount(5);
  await addKeyframe.click();
  await expect(page.locator(".timeline-clip.selected")).toHaveCount(5);
  await expect(page.locator(".timeline-clip.video .clip-animation")).toHaveCount(3);
  await expect(page.locator(".keyframe-edit-status")).toContainText("编辑动画终点");
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(page.locator(".timeline-clip.video .clip-animation")).toHaveCount(0);
  await seek(8);
  await page.getByRole("button", { name: "动画", exact: true }).click();
  await page.getByRole("tab", { name: "缩放与平移", exact: true }).click();
  await expect(page.getByLabel("取景中心 X (%)")).toHaveCount(0);
  await expect(page.getByLabel("取景中心 Y (%)")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "添加当前位置关键帧", exact: true })).toHaveCount(0);
  await page.getByLabel("画布缩放百分比", { exact: true }).fill("200");
  await expect(page.locator(".camera-keyframe-list")).toHaveCount(0);
  await expect(page.locator(".timeline-clip.video .clip-animation")).toHaveCount(3);
  const overviewBounds = await page.locator(".zoom-pan-overview").boundingBox();
  const viewportLeft = (await page.locator(".camera-viewport").boundingBox()).x;
  await dragHandle(
    page.locator(".camera-viewport"),
    overviewBounds.width * 0.1,
    0,
  );
  expect((await page.locator(".camera-viewport").boundingBox()).x).toBeGreaterThan(viewportLeft);
  await seek(9);
  await page.getByLabel("画布缩放百分比", { exact: true }).fill("300");
  await expect(page.locator(".timeline-clip.video .clip-animation")).toHaveCount(6);
  await expect(page.locator(".ruler .camera-keyframe")).toHaveCount(0);
  await page.getByRole("button", { name: "全画面", exact: true }).click();
  await expect(page.getByLabel("画布缩放百分比", { exact: true })).toHaveValue(
    "100",
  );
  await page.getByRole("button", { name: "画布大小设置", exact: true }).click();
  await canvasSettings.getByLabel("宽度（像素）", { exact: true }).fill("1300");
  await canvasSettings.getByLabel("高度（像素）", { exact: true }).fill("740");
  await canvasSettings.getByRole("button", { name: "应用", exact: true }).click();
  await app.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [root],
    });
  }, root);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("工程已保存", {
    timeout: 20000,
  });
  const saved = JSON.parse(
    await fs.readFile(path.join(root, "界面测试", "界面测试.troncut"), "utf8"),
  );
  expect(saved.camera).toBeUndefined();
  expect(saved.canvas).toEqual({ ...project.canvas, width: 1300, height: 740 });
  const savedRecording = saved.clips.find((clip) => clip.id === "recorded-clip");
  expect(savedRecording.contentTransform.scale).toBe(savedVideoContent.scale);
  expect(savedRecording.contentTransform.x).toBeCloseTo(savedVideoContent.x, 5);
  expect(savedRecording.contentTransform.y).toBeCloseTo(savedVideoContent.y, 5);
  expect(saved.clips.filter((clip) => clip.kind === "video").every((clip) => clip.keyframes.some((frame) => frame.zoomPan))).toBe(true);
  expect(saved.clips.filter((clip) => clip.kind !== "video").every((clip) => clip.keyframes.every((frame) => !frame.zoomPan))).toBe(true);
  expect(saved.tracks.map((track) => track.name)).toEqual(
    Array.from({ length: saved.tracks.length }, (_, index) => `轨道${saved.tracks.length - index}`),
  );
  expect(saved.tracks.every((track) => !("kind" in track))).toBe(true);
  expect(saved.clips.find((clip) => clip.kind === "text").text).toBe(
    "中文第一行\n第二行\n第三行",
  );
  const savedText = saved.clips.find((clip) => clip.kind === "text");
  expect(savedText.autoResizeText).toBe(true);
  expect(savedText.textBox.width).toBeGreaterThan(16);
  expect(savedText.textBox.height).toBeGreaterThan(16);
  expect(savedText.style.fontSize).toBeCloseTo(savedTextFont, 2);
  console.log(
    "画布图片等比缩放、端点放大回落动效、文本编辑、缩放平移同步三段视频动画且移除刻度尺关键帧通过",
  );
  expect(errors).toEqual([]);
  await page.screenshot({ path: path.join(root, "compact-titlebar.png") });
  await app.evaluate(({ dialog }) => {
    delete process.env.FRAMECRAFT_SMOKE;
    globalThis.closePrompts = 0;
    dialog.showMessageBoxSync = () => {
      globalThis.closePrompts++;
      return 0;
    };
  });
  await page.evaluate(() => window.framecraft.markDirty(true));
  await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
  await expect.poll(() => app.evaluate(() => globalThis.closePrompts)).toBe(1);
  expect(
    await app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
    ),
  ).toBe(1);
  await page.evaluate(() => window.framecraft.markDirty(false));
  const exited = new Promise((resolve) => app.process().once("exit", resolve));
  try {
    await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
  } catch (error) {
    // The app may exit before Playwright receives the click acknowledgement.
    if (!page.isClosed() || !String(error).includes("Target page, context or browser has been closed"))
      throw error;
  }
  const exitCode = await Promise.race([
    exited,
    new Promise((_, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("关闭窗口未退出")),
        10000,
      );
      timeout.unref();
    }),
  ]);
  expect(exitCode).toBe(0);
  console.log(
    "紧凑标题栏、隐藏原生窗口栏、最大化/还原、最小化、自定义关闭及未保存退出确认通过",
  );
  console.log(`界面截图：${path.join(root, "compact-titlebar.png")}`);
  console.log(
    `${packaged ? "打包程序" : "开发程序"}：刻度尺固定及定位、轨道对齐、鼠标标签页、片段复制、图片与视频粘贴、输入框粘贴边界通过`,
  );
} catch (error) {
  const page = app.windows()[0];
  if (page && !page.isClosed()) {
    console.error(
      await page.evaluate(() => ({
        time: document.querySelector(".timecode")?.textContent,
        selected: document.querySelector(".timeline-clip.selected")
          ?.textContent,
        layers: [
          ...document.querySelectorAll(".preview-panel .preview-layer"),
        ].map((element) => element.className),
      })),
    );
    await page
      .screenshot({ path: path.join(root, "failure.png") })
      .catch(() => {});
    console.error(`失败截图：${path.join(root, "failure.png")}`);
  }
  throw error;
} finally {
  await app.close().catch(() => {});
}
