import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";

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
    "1",
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
      duration: 1,
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
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.locator(".track-header")).toHaveCount(14);
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
  await expect(
    page.getByRole("tab", { name: "视频", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("鼠标样式")).toBeHidden();
  await page.getByRole("tab", { name: "鼠标", exact: true }).click();
  await page.getByLabel("鼠标样式").selectOption("circle");
  await page.getByLabel("鼠标大小").fill("48");
  await expect(page.getByLabel("位置 X (%)")).toBeHidden();
  await page.getByRole("tab", { name: "视频", exact: true }).click();
  await expect(page.getByLabel("位置 X (%)")).toBeVisible();
  await page.getByRole("tab", { name: "鼠标", exact: true }).click();
  await expect(page.getByLabel("鼠标样式")).toHaveValue("circle");
  await expect(page.getByLabel("鼠标大小")).toHaveValue("48");
  await page.getByRole("tab", { name: "视频", exact: true }).click();
  const canvasVideo = page.locator(".preview-panel .preview-layer.video");
  await page.getByLabel("缩放 (%)", { exact: true }).fill("50");
  const videoHandle = canvasVideo.locator(".resize-handle.se");
  await videoHandle.hover();
  const videoBefore = await canvasVideo.boundingBox();
  const videoHandleBounds = await videoHandle.boundingBox();
  const videoX = videoHandleBounds.x + videoHandleBounds.width / 2,
    videoY = videoHandleBounds.y + videoHandleBounds.height / 2;
  await page.mouse.move(videoX, videoY);
  await page.mouse.down();
  await page.mouse.move(videoX + 36, videoY + 20, { steps: 1 });
  await page.mouse.up();
  await expect.poll(async () => (await canvasVideo.boundingBox()).width).toBeGreaterThan(videoBefore.width);
  const videoAfter = await canvasVideo.boundingBox();
  expect(videoAfter.width).toBeGreaterThan(videoBefore.width);
  expect(videoAfter.width / videoAfter.height).toBeCloseTo(16 / 9, 2);

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
  await page.locator(".timeline-clip.image").click();
  await expect(
    page.getByRole("tab", { name: "鼠标", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("开始 (秒)").fill("6");
  await page.keyboard.press("Control+v");
  // Native paste may validly change a number input using the user's clipboard.
  // Restore the fixture time before the canvas checks without modifying that clipboard.
  await page.getByLabel("开始 (秒)").fill("6");
  await expect(page.locator(".timeline-clip.image")).toHaveCSS("left", "390px");
  await expect(page.locator(".timeline-clip.image")).toHaveCount(1);
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
  await page.getByRole("button", { name: "自动动画", exact: true }).click();
  await seek(8);
  await dragHandle(canvasImage.locator(".resize-handle.se"), 20, 16, 1);
  await expect(page.locator(".inspector .keyframe-list > div")).toHaveCount(2);
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
  await imageLock.click();

  await page.getByRole("button", { name: "添加文本", exact: true }).click();
  const canvasText = page.locator(".preview-panel .preview-layer.text");
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

  await page.getByRole("button", { name: "缩放与平移", exact: true }).click();
  await page.getByLabel("画布缩放百分比", { exact: true }).fill("200");
  await expect(page.locator(".camera-keyframe-list > div")).toHaveCount(2);
  const overviewBounds = await page.locator(".zoom-pan-overview").boundingBox();
  await dragHandle(
    page.locator(".camera-viewport"),
    overviewBounds.width * 0.1,
    0,
  );
  expect(
    Number(await page.getByLabel("取景中心 X (%)").inputValue()),
  ).toBeGreaterThan(55);
  await seek(9);
  await page.getByLabel("画布缩放百分比", { exact: true }).fill("300");
  await expect(page.locator(".camera-keyframe-list > div")).toHaveCount(3);
  await expect(page.locator(".ruler .camera-keyframe")).toHaveCount(3);
  await page.getByRole("button", { name: "全画面", exact: true }).click();
  await expect(page.getByLabel("画布缩放百分比", { exact: true })).toHaveValue(
    "100",
  );
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
  expect(saved.camera.keyframes).toHaveLength(3);
  expect(saved.clips.find((clip) => clip.kind === "text").text).toBe(
    "中文第一行\n第二行\n第三行",
  );
  console.log(
    "画布图片等比缩放及自动关键帧、画布/时间线双击文本与多行编辑、整个画面缩放平移与运镜关键帧通过",
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
  await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
  await Promise.race([
    exited,
    new Promise((_, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("关闭窗口未退出")),
        10000,
      );
      timeout.unref();
    }),
  ]);
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
