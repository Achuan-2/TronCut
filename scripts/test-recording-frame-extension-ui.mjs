import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { setTimelineZoom, timelineZoom } from "./timeline-zoom.mjs";

const root = path.resolve(
  `test-output/recording-frame-extension-ui/run-${Date.now()}`,
);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
const helpers = path.join(root, "helpers.cjs");
await build({
  stdin: {
    contents: `export { createProject } from "./shared/model";
      export { addRecordedAssets, defaultRecordingSettings } from "./shared/recording";
      export { RecordingStyleStore } from "./electron/recording-style";
      export { probeMedia } from "./electron/media";
      export { saveProject, openProject } from "./electron/project-store";
      export { findBinary, runProcess } from "./electron/process";`,
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
  addRecordedAssets,
  defaultRecordingSettings,
  RecordingStyleStore,
  probeMedia,
  saveProject,
  openProject,
  findBinary,
  runProcess,
} = createRequire(import.meta.url)(helpers);
const source = path.join(root, "screen.mp4");
await runProcess(findBinary("ffmpeg"), [
  "-y",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=s=320x180:r=20:d=4",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:duration=4",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  source,
]);
const asset = await probeMedia(source);
const bg = await new RecordingStyleStore(root).background(320, 180, "violet");
let project = createProject("录屏帧定格桌面验证");
project.canvas = { width: 320, height: 180, fps: 20, background: "#000000" };
project = addRecordedAssets(
  project,
  [
    { asset, kind: "screen" },
    { asset: { ...asset, id: "mic", kind: "audio" }, kind: "microphone" },
    { asset: { ...asset, id: "camera" }, kind: "camera" },
  ],
  { ...defaultRecordingSettings, autoZoom: false, background: true },
  0,
  bg,
);
const screen = project.clips[0];
screen.keyframes = [0, 2, 4].map((time) => ({
  time,
  value: { ...screen.transform, contentScale: 1 + time / 4 },
  easing: "linear",
  recordingZoom: true,
}));
const camera = project.clips.find((clip) => clip.assetId === "camera");
const members = project.clips.filter((clip) => clip.groupId === screen.groupId);
project.clips.push(
  ...members.map((clip) => ({
    ...clip,
    id: `later-${clip.id}`,
    groupId: undefined,
    recording: undefined,
    recordingRole: undefined,
    start: 4,
    duration: 1,
    sourceIn: 0,
    keyframes: [],
  })),
);
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
await app.evaluate(({ BrowserWindow }) =>
  BrowserWindow.getAllWindows()[0].setSize(1440, 1000),
);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const clip = page.locator(`.timeline-clip[data-clip-id="${screen.id}"]`);
const region = clip.locator(".frame-extension-region");
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
const choose = async (name, target = clip) => {
  await target.click({ button: "right", position: { x: 14, y: 12 } });
  await page.getByRole("menuitem", { name, exact: true }).click();
};
const assertSaved = (saved, duration) => {
  for (const member of members) {
    const next = saved.clips.find((clip) => clip.id === member.id);
    expect(next.duration).toBe(4 + duration);
    expect(next.groupId).toBe(screen.groupId);
    expect(
      saved.clips.find((clip) => clip.id === `later-${member.id}`).start,
    ).toBe(4 + duration);
    if (member.kind !== "image")
      expect(next.stitch?.filter((part) => part.freeze)).toHaveLength(
        duration ? 1 : 0,
      );
  }
  expect(saved.clips.find((clip) => clip.id === camera.id)).toEqual(camera);
};
try {
  await expect(clip).toBeVisible();
  await expect(clip).toHaveClass(/recording-object/);
  await setTimelineZoom(page, 80);
  await page.getByLabel("预览画质", { exact: true }).selectOption("original");
  for (const position of ["start", "end", "playhead"]) {
    await seek(position === "playhead" ? 1 : 6);
    await clip.click({ button: "right", position: { x: 14, y: 12 } });
    await expect(
      page.getByRole("menuitem", { name: "帧定格…", exact: true }),
    ).toBeEnabled();
    await page.getByRole("menuitem", { name: "帧定格…", exact: true }).click();
    await dialog
      .getByRole("combobox", { name: "定格位置", exact: true })
      .selectOption(position);
    await seconds.fill("1");
    await seconds.press("Enter");
    await expect(region).toHaveAttribute("data-duration", "1");
    await expect(region).toHaveAttribute(
      "data-start",
      position === "start" ? "0" : position === "end" ? "4" : "1",
    );
    assertSaved(await save(), 1);
    if (position !== "playhead") {
      await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
      await expect(region).toHaveCount(0);
    }
  }
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(region).toHaveCount(0);
  await page.getByTitle("重做 Ctrl+Shift+Z", { exact: true }).click();
  await expect(region).toHaveCount(1);
  await region.dblclick();
  await seconds.fill("2");
  await seconds.press("Enter");
  await expect(region).toHaveAttribute("data-duration", "2");
  assertSaved(await save(), 2);
  const handle = await region
    .getByRole("button", { name: "调整帧定格时长", exact: true })
    .boundingBox();
  await page.mouse.move(handle.x + 5, handle.y + 8);
  await page.mouse.down();
  await page.mouse.move(
    handle.x + 5 + (await timelineZoom(page)),
    handle.y + 8,
    { steps: 10 },
  );
  await page.mouse.up();
  await expect(region).toHaveAttribute("data-duration", "3");
  assertSaved(await save(), 3);
  await page
    .locator(".timeline")
    .screenshot({ path: path.join(root, "recording-freeze.png") });
  await seek(1.2);
  const video = page.locator(
    `.preview-layer[data-clip-id="${screen.id}"] video`,
  );
  await expect(video).toHaveCount(1);
  await page.getByTitle("播放 / 暂停（空格）", { exact: true }).click();
  await expect
    .poll(async () =>
      Number(
        await page
          .getByRole("slider", { name: "范围起点", exact: true })
          .getAttribute("aria-valuenow"),
      ),
    )
    .toBeGreaterThan(1.8);
  expect(await video.evaluate((media) => media.paused)).toBe(true);
  expect(await video.evaluate((media) => media.muted)).toBe(true);
  expect(await video.evaluate((media) => media.currentTime)).toBeCloseTo(1, 1);
  await expect
    .poll(() => video.evaluate((media) => media.currentTime))
    .toBeGreaterThan(1.25);
  expect(await video.evaluate((media) => media.paused)).toBe(false);
  await page.getByTitle("播放 / 暂停（空格）", { exact: true }).click();
  await choose("移除帧定格", region);
  await expect(region).toHaveCount(0);
  const removed = await save();
  for (const member of members) {
    const next = removed.clips.find((clip) => clip.id === member.id);
    expect(next.duration).toBe(4);
    expect(next.stitch).toBeUndefined();
    expect(
      removed.clips.find((clip) => clip.id === `later-${member.id}`).start,
    ).toBe(4);
  }
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(region).toHaveAttribute("data-duration", "3");
  assertSaved(await save(), 3);
  await page.reload();
  await page.getByRole("button", { name: new RegExp(project.name) }).click();
  await expect(region).toHaveAttribute("data-duration", "3");
  const lockedProject = await openProject(file);
  const microphone = lockedProject.clips.find((clip) => clip.assetId === "mic");
  lockedProject.tracks.find((track) => track.id === microphone.trackId).locked =
    true;
  await saveProject(lockedProject, file);
  await page.reload();
  await page.getByRole("button", { name: new RegExp(project.name) }).click();
  await expect(
    region.getByRole("button", { name: "调整帧定格时长", exact: true }),
  ).toBeDisabled();
  await region.click({ button: "right", position: { x: 14, y: 12 } });
  await expect(
    page.getByRole("menuitem", { name: "调整帧定格时长", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("menuitem", { name: "移除帧定格", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await region.dblclick();
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
  console.log(
    `录屏对象三种定格位置、内部音频背景及后续素材同步、双击修改、边缘调时、预览停帧恢复、移除、撤销重做、保存重开及内部轨道锁定通过：${root}`,
  );
} catch (error) {
  await page
    .screenshot({ path: path.join(root, "failure.png") })
    .catch(() => {});
  throw error;
} finally {
  await app.close();
}
