import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const root = path.resolve("test-output/media-input", `run-${Date.now()}`),
  profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
const image = path.join(root, "中文 图片.png"),
  video = path.join(root, "外部 视频.mp4"),
  audio = path.join(root, "外部 音频.wav"),
  broken = path.join(root, "损坏.png"),
  text = path.join(root, "说明.txt");
await sharp({
  create: { width: 1024, height: 768, channels: 3, background: "#76e5b5" },
})
  .png()
  .toFile(image);
await fs.writeFile(broken, "not an image");
await fs.writeFile(text, "说明");
await promisify(execFile)(
  path.resolve("resources/bin/ffmpeg.exe"),
  [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=320x180:r=30",
    "-t",
    "1",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    video,
  ],
  { windowsHide: true },
);
await promisify(execFile)(
  path.resolve("resources/bin/ffmpeg.exe"),
  ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", audio],
  { windowsHide: true },
);
const project = {
  format: "troncut",
  version: 1,
  id: "media-input",
  name: "媒体输入测试",
  canvas: { width: 320, height: 180, fps: 30, background: "#101319" },
  assets: [],
  clips: [],
  markers: [],
  tracks: ["top", "bottom"].map((id, i) => ({
    id,
    name: `轨道${2 - i}`,
    hidden: false,
    locked: false,
    muted: false,
  })),
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
    ? { executablePath: path.resolve(process.env.FRAMECRAFT_PACKAGED_APP) }
    : {}),
  args: packaged ? [] : ["."],
  env,
});
try {
  const page = await app.firstWindow(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.locator(".home-page")).toBeVisible();
  await page.getByRole("button", { name: "恢复编辑", exact: true }).click();
  await expect(page.locator(".track-lane")).toHaveCount(2);
  // A native file input retains real disk paths through the preload bridge.
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.id = "external-files";
    input.hidden = true;
    document.body.append(input);
  });
  const projectMedia = page.locator(".media-browser");
  const dropIntoProject = async (files, selector = ".library-empty", repeat = 1) => {
    await page.locator("#external-files").setInputFiles(files);
    const canceled = await page.locator("#external-files").evaluate((input, selector) => {
      const data = new DataTransfer();
      for (const file of input.files) data.items.add(file);
      return !document.querySelector(selector).dispatchEvent(new DragEvent("dragover", {
        bubbles: true, cancelable: true, dataTransfer: data,
      }));
    }, selector);
    expect(canceled).toBe(true);
    await expect(projectMedia).toHaveClass(/media-file-drop/);
    // Moving between descendants must keep the drop feedback visible.
    await projectMedia.dispatchEvent("dragleave", {
      relatedTarget: await page.locator(selector).first().elementHandle(),
    });
    await expect(projectMedia).toHaveClass(/media-file-drop/);
    await page.locator("#external-files").evaluate((input, { selector, repeat }) => {
      for (let i = 0; i < repeat; i++) {
        const data = new DataTransfer();
        for (const file of input.files) data.items.add(file);
        document.querySelector(selector).dispatchEvent(new DragEvent("drop", {
          bubbles: true, cancelable: true, dataTransfer: data,
        }));
      }
    }, { selector, repeat });
    await expect(projectMedia).not.toHaveClass(/media-file-drop/);
  };
  const cards = page.locator(".asset-card");
  await dropIntoProject([image, video, audio, text], ".library-empty", 2);
  await expect(cards).toHaveCount(3);
  await expect(page.locator(".timeline-clip")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "项目媒体", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: path.join(root, "project-media-drop.png") });
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(cards).toHaveCount(0);
  await page.getByTitle("重做 Ctrl+Shift+Z", { exact: true }).click();
  await expect(cards).toHaveCount(3);
  await expect(page.locator(".timeline-clip")).toHaveCount(0);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(cards).toHaveCount(0);
  await dropIntoProject([text]);
  await expect(page.getByRole("status")).toContainText("没有可导入");
  await expect(cards).toHaveCount(0);
  await dropIntoProject([broken]);
  await expect(page.getByRole("status")).toContainText("unsupported image format", { timeout: 10000 });
  await expect(cards).toHaveCount(0);
  // Substitute only native clipboard accessors, preserving the user's actual
  // clipboard. The PNG persistence, probing, registration and renderer IPC run normally.
  await app.evaluate(({ clipboard, nativeImage }, image) => {
    globalThis.clipboardReads = 0;
    clipboard.readBuffer = () => Buffer.alloc(0);
    clipboard.availableFormats = () => ["image/png"];
    clipboard.readImage = () => {
      globalThis.clipboardReads++;
      return nativeImage.createFromPath(image);
    };
  }, image);
  const tools = page.locator(".tool-rail");
  await tools.getByRole("button", { name: "标注", exact: true }).click();
  const started = Date.now();
  await page.evaluate(() => {
    for (let i = 0; i < 3; i++)
      document.body.dispatchEvent(
        new ClipboardEvent("paste", { bubbles: true, cancelable: true }),
      );
  });
  await expect(page.locator(".timeline-clip.image")).toHaveCount(1, {
    timeout: 5000,
  });
  expect(Date.now() - started).toBeLessThan(5000);
  await expect(page.locator(".busy-overlay")).toHaveCount(0);
  await expect(tools.locator(".selected")).toHaveText("标注");
  expect(await app.evaluate(() => globalThis.clipboardReads)).toBe(1);
  await expect(page.locator(".track-lane")).toHaveCount(2);
  await expect(page.locator('.track-lane[data-track="top"] .timeline-clip.image')).toHaveCount(1);
  expect(await fs.readdir(path.join(profile, "pasted-media"))).toHaveLength(1);
  await page.screenshot({ path: path.join(root, "fast-image-paste.png") });

  // Populate a real file input so Electron webUtils receives native File paths,
  // rather than invented File.path properties or mocked import results.
  const drop = async (files, lane, time) => {
    await page.locator("#external-files").setInputFiles(files);
    await lane.scrollIntoViewIfNeeded();
    const bounds = await lane.boundingBox();
    await page.locator("#external-files").evaluate(
      (input, point) => {
        const data = new DataTransfer();
        for (const file of input.files) data.items.add(file);
        const target = document.elementFromPoint(point.x, point.y);
        target.dispatchEvent(
          new DragEvent("dragover", {
            bubbles: true,
            cancelable: true,
            dataTransfer: data,
            clientX: point.x,
            clientY: point.y,
          }),
        );
      },
      { x: bounds.x + time * 65, y: bounds.y + bounds.height / 2 },
    );
    await expect(page.locator(".external-drop-marker")).toBeVisible();
    await page.locator("#external-files").evaluate(
      (input, point) => {
        const data = new DataTransfer();
        for (const file of input.files) data.items.add(file);
        document
          .elementFromPoint(point.x, point.y)
          .dispatchEvent(
            new DragEvent("drop", {
              bubbles: true,
              cancelable: true,
              dataTransfer: data,
              clientX: point.x,
              clientY: point.y,
            }),
          );
      },
      { x: bounds.x + time * 65, y: bounds.y + bounds.height / 2 },
    );
  };
  const target = page.locator('.track-lane[data-track="bottom"]');
  await tools.getByRole("button", { name: "视觉效果", exact: true }).click();
  await drop([image, video, text], target, 3);
  await expect(page.locator(".timeline-clip.image")).toHaveCount(2);
  await expect(page.locator(".timeline-clip.video")).toHaveCount(1);
  const droppedImage = target.locator(".timeline-clip.image");
  await expect(droppedImage).toHaveCSS("left", "195px");
  await expect(page.locator(".timeline-clip.video")).toHaveCSS("left", "195px");
  await expect(page.locator(".busy-overlay")).toHaveCount(0);
  await expect(page.locator(".timeline-clip.selected")).toHaveCount(2);
  await expect(tools.locator(".selected")).toHaveText("视觉效果");
  await page.screenshot({ path: path.join(root, "external-media-drop.png") });
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(page.locator(".timeline-clip")).toHaveCount(1);
  await drop([broken], target, 3);
  await expect(page.getByRole("status")).toContainText(
    "unsupported image format",
    { timeout: 10000 },
  );
  await expect(page.locator(".workspace-status")).not.toContainText("正在添加");
  await expect(page.locator(".timeline-clip")).toHaveCount(1);
  await drop([video], target, 4);
  await expect(target.locator(".timeline-clip.video")).toHaveCSS(
    "left",
    "260px",
  );
  await expect(page.locator(".timeline-clip")).toHaveCount(2);
  await expect(tools.locator(".selected")).toHaveText("视觉效果");
  await tools.getByRole("button", { name: "媒体", exact: true }).click();
  const before = await cards.count();
  await page.getByRole("button", { name: "列表视图", exact: true }).click();
  await dropIntoProject([audio], ".asset-card");
  await expect(cards).toHaveCount(before + 1);
  await expect(page.locator(".timeline-clip")).toHaveCount(2);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(cards).toHaveCount(before);
  await expect(page.locator(".timeline-clip")).toHaveCount(2);
  expect(errors).toEqual([]);
  console.log(
    `项目媒体空白/列表拖入、批量音视频图片、撤销重做、防重复及错误恢复；剪贴板与时间线拖入回归通过：${root}`,
  );
} catch (error) {
  const page = await app.firstWindow();
  await page
    .screenshot({ path: path.join(root, "failure.png") })
    .catch(() => {});
  throw error;
} finally {
  await app.close();
}
