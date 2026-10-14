import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const root = path.resolve("test-output/cli-real", `run-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const profile = path.resolve(
  process.env.TRONCUT_CLI_TEST_PROFILE ??
    "test-output/onnx-integration/profile",
);
const env = {
  ...process.env,
  FRAMECRAFT_USER_DATA: profile,
  FRAMECRAFT_SMOKE: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.env.TRONCUT_CLI_TEST_APP;
async function cli(args) {
  const { stdout, stderr } = await execute(
    packaged ? path.resolve(packaged) : process.execPath,
    packaged ? ["--cli", ...args] : [path.resolve("scripts/cli.mjs"), ...args],
    { env, windowsHide: true, timeout: 180000, maxBuffer: 10000000 },
  );
  const result = JSON.parse(stdout.trim());
  assert.equal(result.ok, true, stderr);
  return result;
}
const ffmpeg = path.resolve("resources/bin/ffmpeg.exe");
const input = path.join(root, "红蓝 无声视频.mp4");
await execute(
  ffmpeg,
  [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=320x180:r=15:d=4",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=320x180:r=15:d=4",
    "-filter_complex",
    "[0:v][1:v]concat=n=2:v=1:a=0[v]",
    "-map",
    "[v]",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    input,
  ],
  { windowsHide: true },
);
assert.equal((await cli(["help"])).protocol, "troncut-cli-v1");
assert.equal((await cli(["inspect", "--input", input])).asset.hasAudio, false);
const planFile = path.join(root, "plan.json");
const plan = {
  version: 1,
  name: "Codex CLI 验证",
  cuts: [
    { input: "红蓝 无声视频.mp4", sourceIn: 0, sourceOut: 2 },
    { input: "红蓝 无声视频.mp4", sourceIn: 5, sourceOut: 7 },
  ],
  output: { project: "prepared/project.troncut", video: "prepared/video.mp4" },
};
await fs.writeFile(planFile, JSON.stringify(plan));
const waiting = await cli([
  "run",
  "--plan",
  planFile,
  "--interval",
  "2",
  "--max-frames",
  "2",
]);
assert.equal(waiting.status, "needs_script");
assert.equal(waiting.storyboard.frames.length, 2);
assert.equal(waiting.duration, 4);
// The fixture's two sampled frames are red then blue; the caller supplies the script.
const scriptFile = path.join(root, "script.json");
await fs.writeFile(
  scriptFile,
  JSON.stringify({
    engine: "vits-onnx",
    voice: "0",
    offline: true,
    segments: [
      { start: 0, end: 2, text: "现在是红色画面。" },
      { start: 2, end: 4, text: "接着显示蓝色画面。" },
    ],
  }),
);
const narratedFile = path.join(root, "narrated/project.troncut");
const srt = path.join(root, "narrated/captions.srt");
const narration = await cli([
  "narrate",
  "--project",
  waiting.project,
  "--script",
  scriptFile,
  "--output",
  narratedFile,
  "--srt",
  srt,
]);
assert.equal(narration.captions, 2);
const edited = (await cli(["inspect", "--project", narratedFile])).project;
assert.equal(edited.clips.filter((clip) => clip.caption).length, 2);
assert.ok(
  edited.clips
    .filter((clip) => clip.kind === "audio")
    .every((clip) => clip.start + clip.duration <= 4.01),
);
assert.match(await fs.readFile(srt, "utf8"), /红色画面/);
const video = path.join(root, "narrated/video.mp4");
await cli([
  "export",
  "--project",
  narratedFile,
  "--output",
  video,
  "--software",
]);
const rendered = (await cli(["inspect", "--input", video])).asset;
assert.equal(rendered.hasAudio, true);
assert.ok(Math.abs(rendered.duration - 4) < 0.2);
const asr = process.env.TRONCUT_CLI_TEST_ASR_DIR;
const onePassPlan = path.join(root, "one-pass.json");
await fs.writeFile(
  onePassPlan,
  JSON.stringify({
    ...plan,
    narration: JSON.parse(await fs.readFile(scriptFile, "utf8")),
    output: {
      project: "one-pass/project.troncut",
      video: "one-pass/video.mp4",
      srt: "one-pass/captions.srt",
    },
  }),
);
const onePass = await cli(["run", "--plan", onePassPlan, "--software"]);
assert.equal(onePass.status, "complete");
assert.equal(onePass.captions, 2);
let transcription;
if (asr)
  transcription = await cli([
    "transcribe",
    "--input",
    video,
    "--output",
    path.join(root, "transcribed/project.troncut"),
    "--model-dir",
    path.resolve(asr),
    "--offline",
    "--srt",
    path.join(root, "transcribed/captions.srt"),
  ]);
if (transcription) assert.ok(transcription.captions > 0);
const result = {
  onePass,
  packaged: Boolean(packaged),
  root,
  storyboard: waiting.storyboard,
  narration,
  video,
  transcription,
};
await fs.writeFile(
  path.join(root, "result.json"),
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
