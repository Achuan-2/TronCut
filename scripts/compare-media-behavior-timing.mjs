import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";

// Isolate each entry, using the reference's asset geometry and clip boundaries.
// During/out are disabled so settling measurements do not include a new phase.
const root = path.resolve(`test-output/media-timing-comparison-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
await build({
  stdin: {
    contents:
      'export { createProject, newText } from "./shared/model"; export { createBehavior } from "./shared/behaviors"; export { exportVideo } from "./electron/export"; export { findBinary, runProcess } from "./electron/process";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: path.join(root, "runtime.mjs"),
});
const {
  createProject,
  newText,
  createBehavior,
  exportVideo,
  findBinary,
  runProcess,
} = await import(pathToFileURL(path.join(root, "runtime.mjs")).href);
const base = path.resolve(
  "references/camtasia/媒体行为动画照搬/媒体行为动画照搬.tscproj",
);
const reference = JSON.parse(
  await fs.readFile(path.join(base, "媒体行为动画照搬.tscproj"), "utf8"),
);
const medias = reference.timeline.sceneTrack.scenes[0].csml.tracks
  .flatMap((track) => track.medias ?? [])
  .filter((clip) => clip.effects?.[0]?.in);
const ids = {
  bounceIn: "bounce-in",
  drifting: "drift",
  fadeIn: "fade",
  flyIn: "fly",
  grow: "grow",
  hinge: "hinge",
  implode: "implode",
  reveal: "reveal",
  shifting: "cut",
  sliding: "slide",
};
const assetPath = path.join(root, "reference.png");
const originalAssetPath = path.join(base, "2026-10-20_21-32-19.png");
const originalAsset = await sharp(originalAssetPath).metadata();
const assetSize = await sharp(originalAssetPath)
  .resize({ width: 240 })
  .png()
  .toFile(assetPath);
const segments = [];
for (const [index, media] of medias.entries()) {
  const style = media.effects[0].in.attributes.name;
  const project = createProject(`进场时长校准-${style}`);
  project.canvas = { width: 480, height: 270, fps: 30, background: "#000000" };
  project.exportSettings = { encoder: "software" };
  project.assets = [
    {
      id: "reference",
      name: "reference",
      path: assetPath,
      kind: "image",
      width: assetSize.width,
      height: assetSize.height,
      duration: 0,
      hasAudio: false,
    },
  ];
  const fit = Math.min(480 / assetSize.width, 270 / assetSize.height);
  const clip = {
    ...newText(project.tracks[0].id, 0),
    kind: "image",
    assetId: "reference",
    duration: media.duration / reference.editRate,
  };
  clip.transform = {
    x: 0.5 + media.parameters.translation0.defaultValue / reference.width,
    y: 0.5,
    opacity: 1,
    scale:
      (originalAsset.width *
        media.parameters.scale0.defaultValue *
        (480 / reference.width)) /
      (assetSize.width * fit),
  };
  if (ids[style]) {
    const behavior = createBehavior(
      `media-${ids[style]}`,
      clip.duration,
      "image",
    );
    behavior.during.style = behavior.outgoing.style = "none";
    clip.behaviors = [behavior];
  }
  project.clips = [clip];
  await fs.writeFile(
    path.join(root, `${style}.troncut`),
    JSON.stringify(
      {
        ...project,
        assets: project.assets.map((asset) => ({
          ...asset,
          path: path.basename(asset.path),
        })),
      },
      null,
      2,
    ),
  );
  const output = path.join(root, `segment-${index}.mp4`);
  await exportVideo(
    project,
    output,
    path.join(root, `render-${index}`),
    false,
    AbortSignal.timeout(120000),
    () => {},
  );
  segments.push(`file 'segment-${index}.mp4'`);
  console.log(`已渲染 ${style}`);
}
const concat = path.join(root, "segments.ffconcat");
await fs.writeFile(concat, "ffconcat version 1.0\n" + segments.join("\n"));
const output = path.join(root, "troncut.mp4");
await runProcess(findBinary("ffmpeg"), [
  "-y",
  "-f",
  "concat",
  "-safe",
  "0",
  "-i",
  concat,
  // Audio packet padding must not shift later visual segment boundaries.
  "-an",
  "-vf",
  "setpts=N/(30*TB)",
  "-r",
  "30",
  "-c:v",
  "libx264",
  "-preset",
  "veryfast",
  "-crf",
  "18",
  "-pix_fmt",
  "yuv420p",
  output,
]);
console.log(JSON.stringify({ root, video: output }));
