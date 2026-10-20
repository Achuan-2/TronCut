import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { setTimelineZoom, timelineZoom } from "./timeline-zoom.mjs";

const root = path.resolve(`test-output/frame-extension-ui/run-${Date.now()}`);
const profile = path.join(root, "profile");
const documents = path.join(root, "Documents");
await fs.mkdir(profile, { recursive: true });
await fs.mkdir(documents, { recursive: true });
const helpers = path.join(root, "helpers.cjs");
await build({
  stdin: {
    contents:
      'export { createProject, newText } from "./shared/model"; export { probeMedia } from "./electron/media"; export { saveProject } from "./electron/project-store"; export { findBinary, runProcess } from "./electron/process";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  packages: "external",
  format: "cjs",
  outfile: helpers,
});
const {
  createProject,
  newText,
  probeMedia,
  saveProject,
  findBinary,
  runProcess,
} = createRequire(import.meta.url)(helpers);
const source = path.join(root, "source.mp4");
await runProcess(findBinary("ffmpeg"), [
  "-y",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=s=320x180:r=20:d=6",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:duration=6",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  source,
]);
const project = createProject("帧定格桌面验证");
project.canvas.fps = 20;
project.assets = [await probeMedia(source)];
project.clips = [
  {
    ...newText("video", 0),
    id: "video",
    kind: "video",
    assetId: project.assets[0].id,
    duration: 4,
  },
  {
    ...newText("video", 4),
    id: "later",
    kind: "video",
    assetId: project.assets[0].id,
    sourceIn: 4,
    duration: 1,
  },
  {
    ...newText("audio", 0),
    id: "locked",
    kind: "video",
    assetId: project.assets[0].id,
    duration: 4,
    stitch: [
      { sourceIn: 0, duration: 1 },
      { sourceIn: 1, duration: 1, freeze: true },
      { sourceIn: 1, duration: 2 },
    ],
  },
];
project.tracks.find((track) => track.id === "audio").locked = true;
const file = path.join(root, "project", "fixture.troncut");
await saveProject(project, file);
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [".", file], env });
const page = await app.firstWindow();
await app.evaluate(({ app, BrowserWindow }, directory) => {
  app.setPath("documents", directory);
  BrowserWindow.getAllWindows()[0].setSize(1440, 1000);
}, documents);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const clip = (id = "video") =>
  page.locator(`.timeline-clip[data-clip-id="${id}"]`);
const region = () => clip().locator(".frame-extension-region");
const dragRegion = async (target, delta, trackId) => {
  const box = await target.boundingBox();
  const lane = trackId
    ? await page.locator(`.track-lane[data-track="${trackId}"]`).boundingBox()
    : null;
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + delta, lane ? lane.y + lane.height / 2 : y, {
    steps: 10,
  });
  await page.mouse.up();
};
const dialog = page.getByRole("dialog");
const seconds = dialog.getByLabel("持续时间（秒）", { exact: true });
const save = async () => {
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".busy-overlay")).toHaveCount(0);
  await expect(page.locator(".project-save-state")).not.toContainText("*");
  return JSON.parse(await fs.readFile(file, "utf8"));
};
const seek = async (time) => {
  const ruler = await page.locator(".ruler").boundingBox();
  await page.mouse.click(
    ruler.x + time * (await timelineZoom(page)),
    ruler.y + 25,
  );
};
const choose = async (name, target = clip()) => {
  await target.click({ button: "right", position: { x: 14, y: 12 } });
  await page.getByRole("menuitem", { name, exact: true }).click();
};
try {
  await expect(clip()).toBeVisible();
  await setTimelineZoom(page, 80);
  await page.getByLabel("预览画质", { exact: true }).selectOption("original");
  await seek(1);
  await choose("帧定格…");
  await expect(dialog.getByRole("combobox", { name: "定格位置", exact: true })).toHaveValue(
    "playhead",
  );
  expect(await dialog.locator("select option").allTextContents()).toEqual([
    "播放头所在位置",
    "视频开始点",
    "视频结束点",
  ]);
  await expect(seconds).toBeFocused();
  await seconds.fill("0");
  await expect(
    dialog.getByRole("button", { name: "确定", exact: true }),
  ).toBeDisabled();
  await seconds.press("Escape");
  await expect(dialog).toHaveCount(0);
  // Endpoint placement is available even when the playhead is outside this video.
  for (const position of ["start", "end"]) {
    await seek(8);
    await choose("帧定格…");
    await expect(
      dialog.getByRole("button", { name: "确定", exact: true }),
    ).toBeDisabled();
    await dialog.getByRole("combobox", { name: "定格位置", exact: true }).selectOption(position);
    await seconds.fill("0.5");
    await expect(
      dialog.getByRole("button", { name: "确定", exact: true }),
    ).toBeEnabled();
    if (position === "end")
      await page.screenshot({ path: path.join(root, "position-options.png") });
    await seconds.press("Enter");
    await expect(region()).toHaveAttribute(
      "data-start",
      position === "start" ? "0" : "4",
    );
    await expect(region()).toHaveAttribute("data-duration", "0.5");
    const endpointSaved = await save();
    const video = endpointSaved.clips.find((clip) => clip.id === "video");
    expect(video.duration).toBe(4.5);
    expect(video.stitch.find((part) => part.freeze).sourceIn).toBeCloseTo(
      position === "start" ? 0 : 3.95,
      8,
    );
    expect(endpointSaved.clips.find((clip) => clip.id === "later").start).toBe(
      4.5,
    );
    await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
    await expect(region()).toHaveCount(0);
  }
  await seek(1);
  await choose("帧定格…");
  await seconds.fill("1");
  await page.screenshot({ path: path.join(root, "duration-dialog.png") });
  await seconds.press("Enter");
  await expect(region()).toHaveAttribute("data-start", "1");
  await expect(region()).toHaveAttribute("data-duration", "1");
  let saved = await save();
  expect(saved.clips.find((clip) => clip.id === "video").duration).toBe(5);
  expect(saved.clips.find((clip) => clip.id === "later").start).toBe(5);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(region()).toHaveCount(0);
  await page.getByTitle("重做 Ctrl+Shift+Z", { exact: true }).click();
  await expect(region()).toHaveCount(1);
  const moveZoom = await timelineZoom(page);
  const originalStitch = saved.clips.find((clip) => clip.id === "video").stitch;
  await dragRegion(region(), moveZoom, "titles");
  saved = await save();
  expect(saved.clips.find((clip) => clip.id === "video")).toMatchObject({
    trackId: "titles",
    duration: 5,
    stitch: originalStitch,
  });
  expect(saved.clips.find((clip) => clip.id === "video").start).toBeCloseTo(
    1,
    6,
  );
  expect(saved.clips.find((clip) => clip.id === "later").start).toBe(5);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  saved = await save();
  expect(saved.clips.find((clip) => clip.id === "video")).toMatchObject({
    start: 0,
    trackId: "video",
  });
  await region().click();
  await clip("later").click({ modifiers: ["Control"] });
  await expect(clip()).toHaveClass(/selected/);
  await expect(clip("later")).toHaveClass(/selected/);
  await dragRegion(region(), moveZoom);
  saved = await save();
  expect(saved.clips.find((clip) => clip.id === "video")).toMatchObject({
    duration: 5,
    stitch: originalStitch,
  });
  expect(saved.clips.find((clip) => clip.id === "video").start).toBeCloseTo(
    1,
    6,
  );
  expect(saved.clips.find((clip) => clip.id === "later").start).toBeCloseTo(
    6,
    6,
  );
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await dragRegion(
    clip("locked").locator(".frame-extension-region"),
    moveZoom,
    "titles",
  );
  saved = await save();
  expect(saved.clips.find((clip) => clip.id === "locked")).toMatchObject({
    start: 0,
    trackId: "audio",
    duration: 4,
  });
  await region().dblclick();
  await expect(dialog.getByRole("combobox", { name: "定格位置", exact: true })).toHaveCount(0);
  await expect(seconds).toHaveValue("1");
  await seconds.press("Escape");
  await choose("调整帧定格时长", region());
  await expect(seconds).toHaveValue("1");
  await seconds.fill("2");
  await seconds.press("Enter");
  await expect(region()).toHaveAttribute("data-duration", "2");
  const handle = await region()
    .getByRole("button", { name: "调整帧定格时长", exact: true })
    .boundingBox();
  const zoom = await timelineZoom(page);
  await page.mouse.move(handle.x + 5, handle.y + 8);
  await page.mouse.down();
  await page.mouse.move(handle.x + 5 + zoom, handle.y + 8, { steps: 10 });
  await page.mouse.up();
  await expect(region()).toHaveAttribute("data-duration", "3");
  saved = await save();
  expect(saved.clips.find((clip) => clip.id === "later").start).toBe(7);
  await page
    .locator(".timeline")
    .screenshot({ path: path.join(root, "extension-region.png") });
  // The timeline clock advances while the decoder holds and mutes the source.
  await seek(1.2);
  const video = page.locator('.preview-layer[data-clip-id="video"] video');
  await expect(video).toHaveCount(1);
  await page.getByTitle("播放 / 暂停（空格）", { exact: true }).click();
  const rangeStart = page.getByRole("slider", {
    name: "范围起点",
    exact: true,
  });
  await expect
    .poll(async () => Number(await rangeStart.getAttribute("aria-valuenow")))
    .toBeGreaterThan(1.8);
  expect(await video.evaluate((media) => media.paused)).toBe(true);
  expect(await video.evaluate((media) => media.muted)).toBe(true);
  expect(await video.evaluate((media) => media.currentTime)).toBeCloseTo(1, 1);
  await expect
    .poll(() => video.evaluate((media) => media.currentTime))
    .toBeGreaterThan(1.25);
  expect(await video.evaluate((media) => media.paused)).toBe(false);
  await page.getByTitle("播放 / 暂停（空格）", { exact: true }).click();
  await seek(1);
  await clip("locked").click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "调整帧定格时长", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("menuitem", { name: "移除帧定格", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await choose("移除帧定格", region());
  await expect(region()).toHaveCount(0);
  saved = await save();
  expect(saved.clips.find((clip) => clip.id === "video").duration).toBe(4);
  expect(saved.clips.find((clip) => clip.id === "later").start).toBe(4);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(region()).toHaveAttribute("data-duration", "3");
  await save();
  await page.reload();
  await page.getByRole("button", { name: new RegExp(project.name) }).click();
  await expect(region()).toHaveAttribute("data-duration", "3");
  expect(errors).toEqual([]);
  console.log(
    `帧定格三种位置与越界播放头、区域拖动换轨和多选移动、双击及右键编辑/移除、时长拖动、播放停帧与恢复、锁定、撤销重做及保存重开通过：${root}`,
  );
} catch (error) {
  await page
    .screenshot({ path: path.join(root, "failure.png") })
    .catch(() => {});
  throw error;
} finally {
  await app.close();
}
