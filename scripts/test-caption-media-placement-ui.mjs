import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(
  `test-output/caption-media-placement/run-${Date.now()}`,
);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
await sharp({
  create: { width: 160, height: 90, channels: 3, background: "#35996a" },
})
  .png()
  .toFile(path.join(root, "image.png"));
const source = path.join(root, "screen.mp4");
execFileSync(
  path.resolve("resources/bin/ffmpeg.exe"),
  [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=160x90:r=10:d=2",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    source,
  ],
  { windowsHide: true },
);
const bundle = await build({
  stdin: {
    contents: `export { createProject, newText } from "./shared/model";
      export { appendCaptionCues } from "./shared/captions";
      export { addRecordedAssets, defaultRecordingSettings } from "./shared/recording";`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const {
  createProject,
  newText,
  appendCaptionCues,
  addRecordedAssets,
  defaultRecordingSettings,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
let project = createProject("字幕上方保留");
for (const text of ["中文字幕", "English captions"]) {
  project = appendCaptionCues(project, [{ start: 0, end: 5, text }], {
    newTrack: true,
  }).project;
}
project.clips.push(
  ...project.tracks
    .filter((track) => !track.captionTrack)
    .map((track) => newText(track.id, 0)),
);
const captionIds = project.tracks
  .filter((track) => track.captionTrack)
  .map((track) => track.id);
const asset = {
  id: "screen",
  path: "screen.mp4",
  name: "录屏",
  kind: "video",
  width: 160,
  height: 90,
  duration: 2,
  hasAudio: false,
};
// Feed a generated recording result through production insertion; no live capture.
project = addRecordedAssets(
  project,
  [{ asset, kind: "screen" }],
  { ...defaultRecordingSettings, autoZoom: false, background: false },
  0,
);
project.tracks.forEach((track) => {
  track.height = 48;
});
const initialIds = project.tracks.map((track) => track.id);
const assetTrackId = project.clips.find(
  (clip) => clip.recordingRole === "screen",
).trackId;
const file = path.join(root, "fixture.troncut");
await fs.writeFile(file, JSON.stringify(project));
await fs.writeFile(
  path.join(profile, "preferences.json"),
  JSON.stringify({
    storage: {
      projectDirectory: root,
      backupDirectory: path.join(root, "backups"),
    },
  }),
);
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
let page;
const errors = [];
async function launch() {
  app = await electron.launch({ args: [".", file], env });
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page
    .locator(`.track-lane[data-track="${assetTrackId}"]`)
    .scrollIntoViewIfNeeded();
  await expect(page.locator(".recording-object")).toHaveCount(1);
}
const laneIds = () =>
  page
    .locator(".track-lane")
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.track));
const command = (name) =>
  app.evaluate(
    ({ BrowserWindow }, value) =>
      BrowserWindow.getAllWindows()[0].webContents.send("shortcut", value),
    name,
  );
try {
  await launch();
  expect((await laneIds()).slice(0, 2)).toEqual(captionIds);
  expect((await laneIds())[2]).toBe(
    project.clips.find((clip) => clip.recordingRole === "screen").trackId,
  );
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.id = "external-files";
    input.hidden = true;
    document.body.append(input);
  });
  await page
    .locator("#external-files")
    .setInputFiles([path.join(root, "image.png"), source]);
  const lane = page.locator('.track-lane[data-track="video"]');
  await lane.scrollIntoViewIfNeeded();
  const bounds = await lane.boundingBox();
  await page.locator("#external-files").evaluate(
    (input, point) => {
      const data = new DataTransfer();
      for (const file of input.files) data.items.add(file);
      const target = document.elementFromPoint(point.x, point.y);
      for (const type of ["dragover", "drop"])
        target.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            dataTransfer: data,
            clientX: point.x,
            clientY: point.y,
          }),
        );
    },
    { x: bounds.x + 32, y: bounds.y + bounds.height / 2 },
  );
  await expect(page.getByRole("status")).toContainText(
    "已添加 2 个素材到时间线",
  );
  await expect(page.locator(".track-lane")).toHaveCount(initialIds.length + 2);
  expect((await laneIds()).slice(0, 2)).toEqual(captionIds);
  await command("undo");
  await expect(page.locator(".track-lane")).toHaveCount(initialIds.length);
  expect(await laneIds()).toEqual(initialIds);
  await command("redo");
  await expect(page.locator(".track-lane")).toHaveCount(initialIds.length + 2);
  await command("save");
  await expect(page.getByRole("status")).toContainText("项目已保存");
  const saved = JSON.parse(await fs.readFile(file, "utf8"));
  expect(saved.tracks.slice(0, 2).map((track) => track.id)).toEqual(captionIds);
  expect(
    saved.tracks
      .filter((track) => initialIds.includes(track.id))
      .map((track) => track.id),
  ).toEqual(initialIds);
  expect(
    saved.clips
      .filter((clip) => !project.clips.some((old) => old.id === clip.id))
      .every(
        (clip) =>
          saved.tracks.findIndex((track) => track.id === clip.trackId) > 1,
      ),
  ).toBe(true);
  await page.screenshot({ path: path.join(root, "captions-above-media.png") });
  await app.close();
  await launch();
  expect(await laneIds()).toEqual(saved.tracks.map((track) => track.id));
  expect(errors).toEqual([]);
  console.log(
    `录制结果插入、真实文件拖放新增轨道、字幕层级、撤销重做和保存重开通过（未进行实机录制）：${root}`,
  );
} catch (error) {
  await page
    ?.screenshot({ path: path.join(root, "failure.png") })
    .catch(() => {});
  console.error(root);
  throw error;
} finally {
  await app?.close();
}
