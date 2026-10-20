import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve("test-output/loop-media-ui", `run-${Date.now()}`);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
const helper = path.join(root, "helper.cjs");
await build({
  stdin: {
    contents: `export { createProject } from "./shared/model";
export { addRecordedAssets, defaultRecordingSettings } from "./shared/recording";
export { groupSelection, splitSelection } from "./shared/timeline";
export { probeMedia } from "./electron/media";
export { runProcess, findBinary } from "./electron/process";`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  packages: "external",
  format: "cjs",
  outfile: helper,
});
const {
  createProject,
  addRecordedAssets,
  defaultRecordingSettings,
  groupSelection,
  splitSelection,
  probeMedia,
  runProcess,
  findBinary,
} = createRequire(import.meta.url)(helper);
const screen = path.join(root, "screen.mp4"),
  background = path.join(root, "background.mp4"),
  gif = path.join(root, "animated.gif");
await runProcess(findBinary("ffmpeg"), [
  "-y",
  "-f",
  "lavfi",
  "-i",
  "color=white:s=160x90:r=10:d=8",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  screen,
]);
await runProcess(findBinary("ffmpeg"), [
  "-y",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=s=160x90:r=10:d=1",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  background,
]);
await runProcess(findBinary("ffmpeg"), [
  "-y",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=s=64x48:r=10:d=0.4",
  "-loop",
  "0",
  gif,
]);
const project = createProject("循环素材测试");
project.canvas = { width: 320, height: 180, fps: 10, background: "#112233" };
const bg = await probeMedia(background),
  animated = await probeMedia(gif);
const recording = addRecordedAssets(
  project,
  [{ asset: await probeMedia(screen), kind: "screen" }],
  { ...defaultRecordingSettings, autoZoom: false },
  0,
  bg,
);
const ungrouped = groupSelection(recording, [recording.clips[0].id], true);
const bgClip = ungrouped.clips.find((clip) => clip.assetId === bg.id);
const split = splitSelection(ungrouped, [bgClip.id], 3);
const right = split.clips.find(
  (clip) => clip.assetId === bg.id && clip.start === 3,
);
const gifClip = {
  ...right,
  id: "gif",
  groupId: undefined,
  assetId: animated.id,
  name: "GIF",
  trackId: "gif-track",
  start: 1,
  duration: 2,
  sourceIn: 0.2,
  transform: { x: 0.5, y: 0.5, scale: 1, opacity: 1 },
};
split.assets.push(animated);
split.tracks.unshift({
  id: "gif-track",
  name: "GIF",
  hidden: false,
  muted: false,
  locked: false,
});
split.clips.push(gifClip);
await fs.writeFile(
  path.join(profile, "recovery.json"),
  JSON.stringify({ project: split, file: null }),
);
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["."], env });
try {
  const page = await app.firstWindow(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "恢复编辑", exact: true }).click();
  const dragRight = async (id, delta) => {
    const handle = page.locator(
      `.timeline-clip[data-clip-id="${id}"] .trim-handle.right`,
    );
    await handle.hover();
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + delta,
      box.y + box.height / 2,
      { steps: 12 },
    );
    await page.mouse.up();
  };
  const bgRight = page.locator(`.timeline-clip[data-clip-id="${right.id}"]`);
  const before = await bgRight.boundingBox();
  await dragRight(right.id, 260);
  expect((await bgRight.boundingBox()).width).toBeGreaterThan(
    before.width + 240,
  );
  await dragRight("gif", 260);
  await page.locator(".ruler").click({ position: { x: 1.5 * 65, y: 15 } });
  const preview = page.locator('.preview-layer[data-clip-id="gif"] video');
  await expect
    .poll(() => preview.evaluate((video) => video.videoWidth), {
      timeout: 15000,
    })
    .toBe(64);
  const color = () =>
    preview.evaluate((video) => {
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 48;
      const context = canvas.getContext("2d");
      context.drawImage(video, 0, 0);
      return canvas.toDataURL();
    });
  const first = await color();
  await page.locator(".ruler").click({ position: { x: 1.7 * 65, y: 15 } });
  await expect.poll(color).not.toBe(first);
  await page.screenshot({ path: path.join(root, "extended-loops.png") });
  await app.evaluate(
    ({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    },
    path.join(root, "loop.troncut"),
  );
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("项目已保存");
  const saved = JSON.parse(
    await fs.readFile(path.join(root, "loop", "loop.troncut"), "utf8"),
  );
  expect(saved.clips.find((clip) => clip.id === right.id).duration).toBeCloseTo(
    9,
    1,
  );
  expect(saved.clips.find((clip) => clip.id === "gif").duration).toBeCloseTo(
    6,
    1,
  );
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify(
      {
        root,
        durations: saved.clips.map((clip) => [clip.name, clip.duration]),
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  await app.close();
}
