import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Recreate the user's reference timeline with editable TronCut behavior presets.
// Reference assets remain local and are not modified.
const source = path.resolve("references/camtasia/文本行为动画照搬");
const original = JSON.parse(
  await fs.readFile(path.join(source, "行为.tscproj/行为.tscproj"), "utf8"),
);
const root = path.resolve(`test-output/behavior-comparison-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
await build({
  stdin: {
    contents:
      'export { createProject, newText } from "./shared/model"; export { behaviorPresets, createBehavior } from "./shared/behaviors"; export { exportVideo } from "./electron/export"; export { findBinary, runProcess } from "./electron/process";',
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
  behaviorPresets,
  createBehavior,
  exportVideo,
  findBinary,
  runProcess,
} = await import(pathToFileURL(path.join(root, "runtime.mjs")).href);
const project = createProject("Camtasia 行为对照");
project.canvas = { width: 640, height: 360, fps: 15, background: "#000000" };
project.exportSettings = { encoder: "software" };
const media = original.timeline.sceneTrack.scenes[0].csml.tracks[0].medias;
const factor = project.canvas.width / original.width;
const number = (value) => {
  if (typeof value === "object" && value)
    return number(value.keyframes?.[0]?.value ?? value.defaultValue);
  return typeof value === "string"
    ? value
        .split("/")
        .map(Number)
        .reduce((a, b) => a / b)
    : value;
};
project.clips = media.map((item) => {
  const name = item.effects[0].metadata.presetName;
  const preset = behaviorPresets.find((preset) => preset.name === name);
  if (!preset) throw new Error(`没有对应的行为预设：${name}`);
  const clip = newText(
    project.tracks[0].id,
    item.start / original.editRate,
    0,
    item.def.text,
  );
  clip.name = name;
  clip.duration = item.duration / original.editRate;
  clip.style = {
    ...clip.style,
    fontFamily: item.def.font.name,
    fontSize: number(item.def.font.size) * factor,
    color: "#000000",
    outline: "#ffffff",
    outlineWidth: number(item.def["text-stroke-width"]) * factor,
    fillEnabled: false,
  };
  clip.textBox = {
    width: number(item.def.width) * factor,
    height: number(item.def.height) * factor,
  };
  clip.behaviors = [createBehavior(preset.id, clip.duration)];
  return clip;
});
await fs.writeFile(
  path.join(root, "reference.troncut"),
  JSON.stringify(project, null, 2),
);
const replica = path.join(root, "troncut.mp4");
const segments = [];
for (const [index, clip] of project.clips.entries()) {
  const segment = path.join(root, `segment-${index}.mp4`);
  await exportVideo(
    { ...project, clips: [{ ...clip, start: 0 }] },
    segment,
    path.join(root, `render-${index}`),
    false,
    AbortSignal.timeout(60000),
    () => {},
  );
  const duration = project.clips[index + 1]?.start - clip.start;
  segments.push(
    `file 'segment-${index}.mp4'${Number.isFinite(duration) ? `\nduration ${duration}` : ""}`,
  );
  console.log(`已导出 ${index + 1}/${project.clips.length}：${clip.name}`);
}
const concat = path.join(root, "segments.ffconcat");
await fs.writeFile(
  concat,
  "ffconcat version 1.0\n" + segments.join("\n") + "\n",
);
await runProcess(
  findBinary("ffmpeg"),
  ["-y", "-f", "concat", "-safe", "0", "-i", concat, "-c", "copy", replica],
  { timeout: 60000 },
);
await runProcess(
  findBinary("ffmpeg"),
  [
    "-y",
    "-i",
    path.join(source, "行为.mp4"),
    "-i",
    replica,
    "-filter_complex",
    "[0:v]scale=640:360,crop=320:180:160:90,scale=640:360,drawtext=fontfile='C\\:/Windows/Fonts/consola.ttf':text='Camtasia':x=10:y=10:fontsize=20:fontcolor=yellow[l];[1:v]crop=320:180:160:90,scale=640:360,drawtext=fontfile='C\\:/Windows/Fonts/consola.ttf':text='TronCut':x=10:y=10:fontsize=20:fontcolor=yellow[r];[l][r]hstack=inputs=2[v]",
    "-map",
    "[v]",
    "-r",
    "30",
    "-c:v",
    "libx264",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-an",
    path.join(root, "comparison.mp4"),
  ],
  { timeout: 120000 },
);
console.log(
  JSON.stringify({
    root,
    video: path.join(root, "comparison.mp4"),
    project: path.join(root, "reference.troncut"),
  }),
);
