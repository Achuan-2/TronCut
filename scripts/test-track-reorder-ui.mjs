import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(`test-output/track-reorder-ui/run-${Date.now()}`);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
const helpers = path.join(root, "helpers.cjs");
await build({
  stdin: {
    contents: `export { createProject, newText, newTrack } from "./shared/model";
      export { addRecordedAssets, defaultRecordingSettings } from "./shared/recording";
      export { probeMedia } from "./electron/media";
      export { saveProject } from "./electron/project-store";
      export { RecordingStyleStore } from "./electron/recording-style";
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
  newText,
  newTrack,
  addRecordedAssets,
  defaultRecordingSettings,
  probeMedia,
  saveProject,
  RecordingStyleStore,
  findBinary,
  runProcess,
} = createRequire(import.meta.url)(helpers);
const source = path.join(root, "screen.mp4");
await runProcess(findBinary("ffmpeg"), [
  "-y",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=s=320x180:r=10:d=3",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:duration=3",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  source,
]);
const asset = await probeMedia(source);
const background = await new RecordingStyleStore(root).background(
  320,
  180,
  "violet",
);
let project = createProject("轨道拖动排序验收");
project.canvas = { width: 320, height: 180, fps: 10, background: "#000000" };
project = addRecordedAssets(
  project,
  [
    { asset, kind: "screen" },
    { asset: { ...asset, id: "mic", kind: "audio" }, kind: "microphone" },
  ],
  { ...defaultRecordingSettings, autoZoom: false, background: true },
  0,
  background,
);
for (let i = 0; i < 8; i++)
  project.tracks.push(newTrack(project.tracks.length));
project.tracks = project.tracks.map((track) => ({ ...track, height: 56 }));
const title = newText("titles", 0, 0, "标题");
project.clips.push(title);
const master = project.clips[0];
const backdrop = project.clips.find(
  (clip) => clip.recordingRole === "background",
);
const members = project.clips.filter((clip) => clip.groupId === master.groupId);
const file = path.join(root, "project", "fixture.troncut");
await saveProject(project, file);
const baseline = JSON.parse(await fs.readFile(file, "utf8"));
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [".", file], env });
const page = await app.firstWindow();
await app.evaluate(({ BrowserWindow }) => {
  const window = BrowserWindow.getAllWindows()[0];
  window.setSize(1440, 1000);
  window.focus();
});
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const header = (id) => page.locator(`.track-header[data-track-id="${id}"]`);
const order = () =>
  page
    .locator(".track-header")
    .evaluateAll((items) => items.map((item) => item.dataset.trackId));
const start = async (id) => {
  await page.bringToFront();
  await header(id).scrollIntoViewIfNeeded();
  const box = await header(id).boundingBox();
  await page.mouse.move(box.x + 35, box.y + 18);
  await page.mouse.down();
  return box;
};
const moveToHeader = async (targetId, side = "below") => {
  const ratio = side === "above" ? 0.3 : 0.7;
  const viewport = await page.locator(".track-headers").boundingBox();
  const top = viewport.y + 36;
  const bottom = viewport.y + viewport.height;
  let target = await header(targetId).boundingBox();
  const y = target.y + target.height * ratio;
  if (y < top + 8 || y > bottom - 8) {
    await page.mouse.move(viewport.x + 40, y < top + 8 ? top + 8 : bottom - 8, {
      steps: 8,
    });
    await expect
      .poll(
        async () => {
          const box = await header(targetId).boundingBox();
          const point = box.y + box.height * ratio;
          return point >= top + 8 && point <= bottom - 8;
        },
        { intervals: [16], timeout: 5000 },
      )
      .toBe(true);
    target = await header(targetId).boundingBox();
  }
  await page.mouse.move(target.x + 40, target.y + target.height * ratio, {
    steps: 8,
  });
};
const dropAt = async (id, targetId, side = "below") => {
  await start(id);
  await moveToHeader(targetId, side);
  await expect(page.locator(".timeline-body")).toHaveClass(/track-reordering/);
  await expect(
    page.locator(
      ".track-header.track-drop-above, .track-header.track-drop-below",
    ),
  ).toHaveCount(1);
  await page.mouse.up();
};
const save = async () => {
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".busy-overlay")).toHaveCount(0);
  await expect(page.locator(".project-save-state")).not.toContainText("*");
  return JSON.parse(await fs.readFile(file, "utf8"));
};
const assertRecording = (saved) => {
  const tracks = saved.tracks.map((track) => track.id);
  const start = tracks.indexOf(master.trackId);
  expect(tracks.slice(start, start + members.length)).toEqual(
    members.map((clip) => clip.trackId),
  );
  expect(saved.clips).toEqual(baseline.clips);
};
const assertPreview = async () => {
  const layers = await page
    .locator(".canvas .preview-layer")
    .evaluateAll((items) => items.map((item) => item.dataset.clipId));
  expect(layers.indexOf(backdrop.id)).toBeGreaterThanOrEqual(0);
  expect(layers.indexOf(master.id)).toBeGreaterThan(
    layers.indexOf(backdrop.id),
  );
};
try {
  await expect(header(master.trackId)).toBeVisible();
  const original = await order();
  // A short press and tiny movement keep the current order and save state.
  const box = await start(master.trackId);
  await page.mouse.move(box.x + 35, box.y + 20);
  await page.mouse.up();
  expect(await order()).toEqual(original);
  await expect(page.locator(".project-save-state")).not.toContainText("*");
  // Escape and releases outside the track area cancel the gesture.
  await start(master.trackId);
  await moveToHeader("titles");
  await expect(
    page.locator(
      ".track-header.track-drop-above, .track-header.track-drop-below",
    ),
  ).toHaveCount(1);
  await page
    .locator(".timeline")
    .screenshot({ path: path.join(root, "insertion-line.png") });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await order()).toEqual(original);
  await start(master.trackId);
  await page.mouse.move(100, 50, { steps: 8 });
  await page.mouse.up();
  expect(await order()).toEqual(original);
  await dropAt(master.trackId, "titles");
  await expect
    .poll(async () => (await order()).indexOf(master.trackId))
    .toBe(1);
  let moved = await order();
  expect(moved.indexOf(master.trackId)).toBe(1);
  await assertPreview();
  assertRecording(await save());
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  expect(await order()).toEqual(original);
  await page.getByTitle("重做 Ctrl+Shift+Z", { exact: true }).click();
  expect(await order()).toEqual(moved);
  await dropAt(master.trackId, "titles", "above");
  expect(await order()).toEqual(original);
  // Buttons and the height separator retain their independent pointer gestures.
  await header("titles").getByTitle("轨道静音", { exact: true }).click();
  expect(await order()).toEqual(original);
  await expect(page.locator(".timeline-body")).not.toHaveClass(
    /track-reordering/,
  );
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  const height = await header("titles").evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  const grip = await header("titles").getByRole("separator").boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 3);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 23, { steps: 5 });
  await page.mouse.up();
  expect(
    await header("titles").evaluate(
      (element) => element.getBoundingClientRect().height,
    ),
  ).toBe(height + 20);
  expect(await order()).toEqual(original);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  // Holding near an edge scrolls both the header and timeline while dragging.
  await start(master.trackId);
  const viewport = await page.locator(".track-headers").boundingBox();
  await page.mouse.move(viewport.x + 40, viewport.y + viewport.height - 8, {
    steps: 8,
  });
  await expect
    .poll(() =>
      page.locator(".track-headers").evaluate((element) => element.scrollTop),
    )
    .toBeGreaterThan(150);
  await page.mouse.up();
  moved = await order();
  expect(moved.indexOf(master.trackId)).toBeGreaterThan(2);
  await assertPreview();
  const saved = await save();
  assertRecording(saved);
  const scrollPositions = await page
    .locator(".timeline-body")
    .evaluate((body) => [
      body.querySelector(".track-headers").scrollTop,
      body.querySelector(".timeline-scroll").scrollTop,
    ]);
  expect(Math.abs(scrollPositions[0] - scrollPositions[1])).toBeLessThan(2);
  await page
    .locator(".timeline")
    .screenshot({ path: path.join(root, "recording-reordered.png") });
  await page.reload();
  await page.getByRole("button", { name: new RegExp(project.name) }).click();
  expect(await order()).toEqual(moved);
  assertRecording(await save());
  expect(errors).toEqual([]);
  console.log(
    `轨道按住拖动、插入线、上下排序、取消、自动滚动、控件与高度调整、录屏层级、单步撤销重做及保存重开通过：${root}`,
  );
} catch (error) {
  await page
    .screenshot({ path: path.join(root, "failure.png") })
    .catch(() => {});
  throw error;
} finally {
  await app.close();
}
