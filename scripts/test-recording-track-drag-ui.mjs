import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(
  `test-output/recording-track-drag-ui/run-${Date.now()}`,
);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
await fs.writeFile(
  path.join(profile, "preferences.json"),
  JSON.stringify({
    storage: {
      projectDirectory: root,
      backupDirectory: path.join(root, "backups"),
    },
    program: { snapping: false },
  }),
);
const bundle = await build({
  stdin: {
    contents: `export { createProject, validateProject } from "./shared/model";
      export { addRecordedAssets, defaultRecordingSettings } from "./shared/recording";
      export { hasProjectTimelineOverlap } from "./shared/timeline-collision";`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const {
  createProject,
  validateProject,
  addRecordedAssets,
  defaultRecordingSettings,
  hasProjectTimelineOverlap,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const source = path.join(root, "screen.mp4");
execFileSync(
  path.resolve("resources/bin/ffmpeg.exe"),
  [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=160x90:rate=10:duration=4",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=330:duration=4",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-c:a",
    "aac",
    "-shortest",
    source,
  ],
  { windowsHide: true },
);
const asset = {
  id: "screen",
  name: "录屏",
  path: "screen.mp4",
  kind: "video",
  width: 160,
  height: 90,
  duration: 4,
  hasAudio: true,
};
const project = addRecordedAssets(
  createProject("录屏换轨验收"),
  [
    { asset, kind: "screen" },
    { asset: { ...asset, id: "mic", kind: "audio" }, kind: "microphone" },
  ],
  { ...defaultRecordingSettings, autoZoom: false },
  0,
  { ...asset, id: "background", hasAudio: false },
);
project.tracks.forEach((track) => {
  track.height = 70;
});
const master = project.clips[0];
const backdrop = project.clips.find(
  (clip) => clip.recordingRole === "background",
);
const file = path.join(root, "fixture.troncut");
await fs.writeFile(file, JSON.stringify(project));
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
async function launch() {
  app = await electron.launch({ args: [".", file], env });
  const page = await app.firstWindow();
  page.on("console", (message) => {
    if (message.type() === "error") console.error(message.text());
  });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1700, 1000),
  );
  page.on("pageerror", (error) => errors.push(error.message));
  const current = JSON.parse(await fs.readFile(file, "utf8"));
  const trackId = current.clips.find((clip) => clip.id === master.id).trackId;
  await page
    .locator(`.track-lane[data-track="${trackId}"]`)
    .scrollIntoViewIfNeeded();
  try {
    await expect(page.locator(".recording-object")).toHaveCount(1);
  } catch (error) {
    await page.screenshot({ path: path.join(root, "failure.png") });
    console.error(await page.locator("body").innerText());
    throw error;
  }
  return page;
}
const command = (name) =>
  app.evaluate(
    ({ BrowserWindow }, name) =>
      BrowserWindow.getAllWindows()[0].webContents.send("shortcut", name),
    name,
  );
const item = (page) =>
  page.locator(`.timeline-clip[data-clip-id="${master.id}"]`);
async function drag(page, trackId, cancel = false) {
  const bounds = await item(page).boundingBox();
  const lane = await page
    .locator(`.track-lane[data-track="${trackId}"]`)
    .boundingBox();
  await page.mouse.move(bounds.x + 35, bounds.y + 20);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 35, lane.y + 20, { steps: 12 });
  if (cancel) {
    await item(page).dispatchEvent("pointercancel");
  } else {
    await expect
      .poll(() =>
        item(page).evaluate((node) =>
          parseFloat(node.style.translate.split(" ")[1]),
        ),
      )
      .not.toBe(0);
  }
  await page.mouse.up();
}
async function onTrack(page, trackId) {
  await expect
    .poll(() =>
      item(page).evaluate((node) => node.closest(".track-lane").dataset.track),
    )
    .toBe(trackId);
}
try {
  let page = await launch();
  await drag(page, "video", true);
  await onTrack(page, master.trackId);
  await drag(page, "video");
  await onTrack(page, "video");
  await command("undo");
  await onTrack(page, master.trackId);
  await command("redo");
  await onTrack(page, "video");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".busy-overlay")).toHaveCount(0);
  await expect
    .poll(
      async () => JSON.parse(await fs.readFile(file, "utf8")).clips[0].trackId,
    )
    .toBe("video");
  const saved = validateProject(JSON.parse(await fs.readFile(file, "utf8")));
  expect(hasProjectTimelineOverlap(saved)).toBe(false);
  expect(saved.clips).toHaveLength(project.clips.length);
  const anchor = saved.tracks.findIndex((track) => track.id === "video");
  for (const [index, before] of project.clips.entries()) {
    const after = saved.clips.find((clip) => clip.id === before.id);
    expect(after.start).toBe(before.start);
    expect(after.sourceIn).toBe(before.sourceIn);
    expect(after.groupId).toBe(before.groupId);
    expect(saved.tracks.findIndex((track) => track.id === after.trackId)).toBe(
      anchor + index,
    );
  }
  await page.screenshot({ path: path.join(root, "moved.png") });
  await app.close();
  page = await launch();
  await onTrack(page, "video");
  const layers = await page
    .locator(".canvas .preview-layer")
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.clipId));
  expect(layers.indexOf(backdrop.id)).toBeGreaterThanOrEqual(0);
  expect(layers.indexOf(master.id)).toBeGreaterThan(
    layers.indexOf(backdrop.id),
  );
  expect(errors).toEqual([]);
  console.log(`录屏跨轨拖动、取消、撤销重做、保存重开和图层顺序通过：${root}`);
} finally {
  if (app) await app.close();
}
