import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import sharp from "sharp";

const root = path.resolve("test-output/media-library-ui", `run-${Date.now()}`);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
const helpers = path.join(root, "helpers.cjs");
await build({
  stdin: {
    contents: `export { createProject } from "./shared/model";
      export { probeMedia } from "./electron/media";
      export { findBinary, runProcess } from "./electron/process";`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  packages: "external",
  format: "cjs",
  outfile: helpers,
});
const { createProject, probeMedia, findBinary, runProcess } = createRequire(
  import.meta.url,
)(helpers);
const imagePath = path.join(root, "image.png");
await sharp({
  create: { width: 320, height: 180, channels: 3, background: "#71e6b5" },
})
  .png()
  .toFile(imagePath);
const videoPath = path.join(root, "video.mp4");
await runProcess(findBinary("ffmpeg"), [
  "-y",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=s=320x180:r=10:d=2",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  videoPath,
]);
const audioPath = path.join(root, "audio.wav");
await runProcess(findBinary("ffmpeg"), [
  "-y",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:duration=2",
  audioPath,
]);
const [video, audio, image] = await Promise.all(
  [videoPath, audioPath, imagePath].map((file) => probeMedia(file)),
);
video.name = "演示录屏.mp4";
audio.name = "背景音乐.wav";
const project = createProject("素材库验收");
project.assets = [
  video,
  audio,
  ...Array.from({ length: 72 }, (_, index) => ({
    ...image,
    id: `image-${index}`,
    name: `图片-${String(index).padStart(2, "0")}-用于检查长文件名不会撑破素材库布局.png`,
  })),
  {
    ...image,
    id: "offline-image",
    name: "离线图片.png",
    path: path.join(root, "missing.png"),
    missing: true,
  },
];
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
const app = await electron.launch({ args: ["."], env });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1280, 850),
  );
  await page.getByRole("button", { name: "恢复编辑", exact: true }).click();
  const cards = page.locator(".asset-card");
  const search = page.getByRole("textbox", { name: "搜索素材", exact: true });
  const scroller = page.locator(".media-browser-items");
  const grid = page.getByRole("button", { name: "缩略图视图", exact: true });
  const list = page.getByRole("button", { name: "列表视图", exact: true });
  const importButton = page.getByRole("button", {
    name: "导入媒体",
    exact: true,
  });
  await expect(cards).toHaveCount(75);
  await expect(
    page.getByRole("combobox", { name: "素材类别", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "素材分组", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".asset-group-heading")).toHaveCount(0);
  await expect(grid).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByText("保存工程时，素材自动归档", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("JSON 工程，随时看得懂", { exact: true }),
  ).toHaveCount(0);
  await expect
    .poll(() => page.locator(".asset-thumbnail img").count())
    .toBeGreaterThan(0);
  const initiallyLoaded = await page.locator(".asset-thumbnail img").count();
  expect(initiallyLoaded).toBeLessThan(25);
  const footerBefore = await importButton.boundingBox();
  const overflow = await scroller.evaluate((element) => ({
    x: element.scrollWidth - element.clientWidth,
    y: element.scrollHeight - element.clientHeight,
  }));
  expect(overflow.x).toBeLessThanOrEqual(1);
  expect(overflow.y).toBeGreaterThan(1000);
  await page
    .locator(".library")
    .screenshot({ path: path.join(root, "thumbnails.png") });
  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(page.locator('[data-asset-id="image-71"] img')).toBeVisible();
  expect(await importButton.boundingBox()).toEqual(footerBefore);
  const scrollBounds = await scroller.boundingBox();
  expect(scrollBounds.y + scrollBounds.height).toBeLessThanOrEqual(
    footerBefore.y,
  );

  await search.fill("图片-07");
  await expect(cards).toHaveCount(1);
  await search.fill("不存在的文件");
  await expect(scroller.getByRole("status")).toContainText("没有匹配的素材");
  await page.getByRole("button", { name: "清除素材搜索", exact: true }).click();
  await expect(cards).toHaveCount(75);

  await list.click();
  await expect(page.locator(".asset-list")).toHaveCount(1);
  await expect(list).toHaveAttribute("aria-pressed", "true");
  await scroller.evaluate((element) => {
    element.scrollTop = 0;
  });
  await page
    .locator(".library")
    .screenshot({ path: path.join(root, "list.png") });
  await expect(page.locator(".asset-group-heading")).toHaveCount(0);
  await expect(cards).toHaveCount(75);
  await page.reload();
  await page.getByRole("button", { name: "恢复编辑", exact: true }).click();
  await expect(list).toHaveAttribute("aria-pressed", "true");

  // Adding media still works in list mode, with the original drag payload.
  await search.fill("演示录屏");
  await cards.first().click();
  await expect(cards.first()).toHaveAttribute("aria-pressed", "true");
  const dragPayload = await cards.first().evaluate((element) => {
    const dataTransfer = new DataTransfer();
    element.dispatchEvent(
      new DragEvent("dragstart", { bubbles: true, dataTransfer }),
    );
    return dataTransfer.getData("framecraft-asset");
  });
  expect(dragPayload).toBe(video.id);
  await cards.first().dblclick();
  await expect(page.locator(".timeline-clip.video")).toHaveCount(1);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(page.locator(".timeline-clip")).toHaveCount(0);
  await cards.first().press("Enter");
  await expect(page.locator(".timeline-clip.video")).toHaveCount(1);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await cards
    .first()
    .dragTo(page.locator(".track-lane").first(), {
      targetPosition: { x: 80, y: 20 },
    });
  await expect(page.locator(".timeline-clip.video")).toHaveCount(1);

  // Offline media remains relinkable rather than being inserted into the timeline.
  await search.fill("离线图片");
  await expect(cards.first()).toHaveClass(/missing/);
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, imagePath);
  await cards.first().dblclick();
  await search.fill("");
  await expect(page.locator('[data-asset-id="offline-image"]')).not.toHaveClass(
    /missing/,
  );
  await expect(page.locator(".timeline-clip")).toHaveCount(1);
  const importedPath = path.join(root, "新增图片.png");
  await fs.copyFile(imagePath, importedPath);
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, importedPath);
  await importButton.click();
  await expect(
    page.locator(".asset-name").filter({ hasText: "新增图片.png" }),
  ).toHaveCount(1);
  await expect(cards).toHaveCount(76);
  await expect(page.locator(".media-library > .library-heading")).toContainText(
    "76 个素材",
  );
  expect(errors).toEqual([]);
  console.log(
    `项目媒体移除分类、搜索、双视图及偏好重开、独立滚动、按需缩略图、双击/键盘添加、拖拽载荷及离线重链接通过：${root}`,
  );
} catch (error) {
  await (
    await app.firstWindow()
  )
    .screenshot({ path: path.join(root, "failure.png") })
    .catch(() => {});
  throw error;
} finally {
  await app.close();
}
