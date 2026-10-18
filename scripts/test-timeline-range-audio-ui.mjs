import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(
  `test-output/timeline-range-audio-ui/run-${Date.now()}`,
);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
const helpers = path.join(root, "helpers.cjs");
await build({
  stdin: {
    contents:
      'export { createProject, newText } from "./shared/model"; export { probeMedia } from "./electron/media"; export { findBinary, runProcess } from "./electron/process";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  packages: "external",
  format: "cjs",
  outfile: helpers,
});
const { createProject, newText, probeMedia, findBinary, runProcess } =
  createRequire(import.meta.url)(helpers);
const source = path.join(root, "video.mp4");
await runProcess(findBinary("ffmpeg"), [
  "-y",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=s=320x180:r=20:d=14",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:duration=14",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  source,
]);
const project = createProject("时间范围与音视频拆分");
project.assets = [await probeMedia(source)];
project.clips = [
  {
    ...newText("video", 0),
    id: "video",
    kind: "video",
    assetId: project.assets[0].id,
    duration: 10,
  },
  { ...newText("titles", 0), id: "title", duration: 10 },
  {
    ...newText("audio", 12),
    id: "later",
    kind: "audio",
    assetId: project.assets[0].id,
    duration: 2,
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
  await app.evaluate(({ BrowserWindow, dialog }, root) => {
    BrowserWindow.getAllWindows()[0].setSize(1440, 950);
    dialog.showSaveDialog = async () => ({
      canceled: false,
      filePath: `${root}/edited.troncut`,
    });
  }, root);
  await page.getByRole("button", { name: "恢复编辑", exact: true }).click();
  await page.getByLabel("时间线缩放").fill("60");
  const scroll = page.locator(".timeline-scroll");
  await scroll.evaluate((element) => {
    element.scrollLeft = 0;
  });
  const save = async () => {
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.locator(".busy-overlay")).toHaveCount(0);
    return JSON.parse(
      await fs.readFile(path.join(root, "edited", "edited.troncut"), "utf8"),
    );
  };
  await page
    .locator('.timeline-clip[data-clip-id="video"]')
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "拆分视频和音频", exact: true })
    .click();
  await expect(page.locator(".timeline-clip.audio")).toHaveCount(2);
  let saved = await save();
  const separated = saved.clips.find(
    (clip) => clip.kind === "audio" && clip.start === 0,
  );
  expect(saved.clips.find((clip) => clip.id === "video").audioDetached).toBe(
    true,
  );
  expect(separated.duration).toBe(10);
  await page
    .locator('.timeline-clip[data-clip-id="video"]')
    .click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "拆分视频和音频", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(page.locator(".timeline-clip.audio")).toHaveCount(1);
  await page.getByTitle("重做 Ctrl+Shift+Z", { exact: true }).click();
  await expect(page.locator(".timeline-clip.audio")).toHaveCount(2);

  const start = page.getByRole("slider", { name: "范围起点", exact: true });
  const end = page.getByRole("slider", { name: "范围终点", exact: true });
  const overlay = page.locator(".timeline-range-overlay");
  const head = page.getByRole("button", { name: "播放头", exact: true });
  const seek = async (time) => {
    const bounds = await page.locator(".ruler").boundingBox();
    await page.mouse.click(bounds.x + time * 60, bounds.y + 29);
  };
  const dragEnd = async (seconds) => {
    const bounds = await end.boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 5);
    await page.mouse.down();
    await page.mouse.move(
      bounds.x + bounds.width / 2 + seconds * 60,
      bounds.y + 5,
      { steps: 12 },
    );
    await page.mouse.up();
  };
  await seek(2);
  await dragEnd(2);
  await expect(overlay).toHaveAttribute("data-start", "2");
  await expect(overlay).toHaveAttribute("data-end", "4");
  await expect(start).toHaveAttribute("aria-valuenow", "2");
  await page
    .locator(".timeline")
    .screenshot({ path: path.join(root, "range.png") });
  await page.keyboard.press("Delete");
  await expect(overlay).toHaveCount(0);
  saved = await save();
  expect(
    saved.clips
      .filter((clip) => clip.kind === "video")
      .map((clip) => [clip.start, clip.duration, clip.sourceIn]),
  ).toEqual([
    [0, 2, 0],
    [4, 6, 4],
  ]);
  expect(saved.clips.find((clip) => clip.id === "later").start).toBe(12);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await seek(2);
  await dragEnd(2);
  await page.keyboard.press("Shift+Delete");
  saved = await save();
  expect(
    saved.clips
      .filter((clip) => clip.kind === "video")
      .map((clip) => [clip.start, clip.duration, clip.sourceIn]),
  ).toEqual([
    [0, 2, 0],
    [2, 6, 4],
  ]);
  expect(saved.clips.find((clip) => clip.id === "later").start).toBe(10);
  expect(
    saved.clips
      .filter((clip) => clip.trackId === separated.trackId)
      .map((clip) => [clip.start, clip.duration, clip.sourceIn]),
  ).toEqual([
    [0, 2, 0],
    [2, 6, 4],
  ]);
  await expect(start).toHaveAttribute("aria-valuenow", "2");
  await expect(end).toHaveAttribute("aria-valuenow", "2");
  await dragEnd(1);
  await expect(overlay).toHaveCount(1);
  await head.dblclick();
  await expect(overlay).toHaveCount(0);
  await expect(start).toHaveAttribute("aria-valuenow", "3");
  await expect(end).toHaveAttribute("aria-valuenow", "3");
  // The green handle also expands left, including at the start of the timeline.
  const bounds = await start.boundingBox();
  await page.mouse.move(bounds.x + 5, bounds.y + 5);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 5 - 60, bounds.y + 5, { steps: 8 });
  await page.mouse.up();
  await expect(overlay).toHaveAttribute("data-start", "2");
  await head.dblclick();
  await seek(0);
  await expect(start).toBeVisible();
  await dragEnd(1);
  await expect(overlay).toHaveAttribute("data-start", "0");
  await head.dblclick();
  await page
    .locator(".timeline")
    .screenshot({ path: path.join(root, "collapsed.png") });
  expect(errors).toEqual([]);
  console.log(
    `音视频右键拆分/禁用/撤销重做、范围双向拖动、Delete/Shift+Delete、同步裁剪、波纹定位及双击收起通过：${root}`,
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
