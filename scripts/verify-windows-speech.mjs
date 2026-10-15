import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const root = path.resolve(`test-output/windows-speech/run-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const bundle = path.join(root, "services.mjs");
await build({
  stdin: {
    contents: `export {synthesizeSpeech} from './electron/synthesis';
  export {windowsSpeechVoices} from './electron/windows-speech';
  export {saveProject, openProject} from './electron/project-store';
  export {createProject} from './shared/model';
  export {addMediaAssets} from './shared/editor';`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  outfile: bundle,
});
const api = await import(pathToFileURL(bundle));
const workers = path.resolve("workers/onnx");
const voices = await api.windowsSpeechVoices(workers);
assert.ok(voices.length);
assert.ok(
  voices.every(
    (voice) => !/Online/i.test(voice.name) && !/^Edge-/.test(voice.id),
  ),
);
console.log(JSON.stringify({ voices }));
const asset = await api.synthesizeSpeech(
  {
    text: "欢迎使用 Windows 系统语音。图片保存以后，仍然可以重新打开编辑。",
    engine: "windows-sapi",
    voice: "auto",
    offline: true,
    speed: 1.25,
    captionChars: 22,
  },
  {
    workers,
    userData: path.join(root, "profile"),
    resources: path.resolve("resources"),
  },
  new AbortController().signal,
  (percent, label) => console.log(`${percent}% ${label}`),
);
const metadata = JSON.parse(
  await fs.readFile(
    path.join(path.dirname(asset.path), "narration.json"),
    "utf8",
  ),
);
assert.ok(metadata.runtime.segments.length >= 2);
assert.ok(Math.abs(metadata.runtime.duration / 1.25 - asset.duration) < 0.15);
if (voices.some((voice) => /Yunxi/i.test(voice.name)))
  assert.match(metadata.runtime.voiceName, /Yunxi/i);
const data = await fs.readFile(asset.path);
assert.ok(data.length > 10000);
let offset = 12;
while (data.toString("ascii", offset, offset + 4) !== "data")
  offset +=
    8 + data.readUInt32LE(offset + 4) + (data.readUInt32LE(offset + 4) % 2);
const bytes = data.readUInt32LE(offset + 4);
let squares = 0;
for (let i = offset + 8; i < offset + 8 + bytes; i += 2)
  squares += (data.readInt16LE(i) / 32768) ** 2;
const rms = Math.sqrt(squares / (bytes / 2));
assert.ok(rms > 0.005 && rms < 0.6);
const project = api.addMediaAssets(
  api.createProject("Windows系统语音验证"),
  [asset],
  1,
  true,
);
const file = path.join(root, "saved/Windows配音.troncut");
await api.saveProject(project, file);
const opened = await api.openProject(file);
assert.deepEqual(opened.assets[0].narration, asset.narration);
assert.equal(opened.assets[0].missing, false);
const controller = new AbortController();
controller.abort();
await assert.rejects(
  api.synthesizeSpeech(
    { text: "不应启动", engine: "windows-sapi", voice: "auto" },
    { workers, userData: path.join(root, "profile"), resources: "" },
    controller.signal,
    () => {},
  ),
  /取消/,
);
const before = await fs.readdir(path.join(root, "profile/narration"));
const active = new AbortController();
await assert.rejects(
  api.synthesizeSpeech(
    {
      text: "这是一段取消验证文稿。".repeat(60),
      engine: "windows-sapi",
      voice: "auto",
    },
    {
      workers,
      userData: path.join(root, "profile"),
      resources: path.resolve("resources"),
    },
    active.signal,
    (percent) => {
      if (percent >= 15) active.abort();
    },
  ),
  /取消/,
);
assert.deepEqual(
  await fs.readdir(path.join(root, "profile/narration")),
  before,
);
await fs.writeFile(
  path.join(root, "result.json"),
  JSON.stringify(
    {
      voices,
      asset,
      rms,
      runtime: metadata.runtime,
      reopened: file,
      cancellationCleanup: true,
    },
    null,
    2,
  ),
);
console.log(`WINDOWS_SPEECH_OK ${root}`);
if (process.argv.includes("--cli")) {
  const execute = promisify(execFile);
  await execute(
    path.resolve("resources/bin/ffmpeg.exe"),
    [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=navy:s=640x360:r=15:d=8",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      path.join(root, "source.mp4"),
    ],
    { windowsHide: true },
  );
  const plan = {
    version: 1,
    name: "Windows语音CLI验证",
    cuts: [{ input: "source.mp4" }],
    narration: {
      engine: "windows-sapi",
      voice: "auto",
      offline: true,
      segments: [
        { start: 0.2, end: 7.8, text: "这是 Windows 系统语音生成的中文男声。" },
      ],
    },
    output: {
      project: "cli/Windows语音.troncut",
      video: "cli/video.mp4",
      srt: "cli/captions.srt",
    },
  };
  await fs.writeFile(path.join(root, "plan.json"), JSON.stringify(plan));
  const env = {
    ...process.env,
    FRAMECRAFT_USER_DATA: path.join(root, "cli-profile"),
    FRAMECRAFT_SMOKE: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = await execute(
    process.execPath,
    [
      path.resolve("scripts/cli.mjs"),
      "run",
      "--plan",
      path.join(root, "plan.json"),
    ],
    { env, windowsHide: true, timeout: 90000 },
  );
  const completed = JSON.parse(result.stdout.trim());
  assert.equal(completed.status, "complete");
  const reopened = await api.openProject(completed.project);
  assert.equal(
    reopened.assets.find((asset) => asset.narration)?.narration.engine,
    "windows-sapi",
  );
  assert.ok(
    reopened.clips.some((clip) => clip.caption && /Windows/.test(clip.text)),
  );
  assert.ok((await fs.stat(completed.video)).size > 10000);
  await fs.writeFile(
    path.join(root, "cli-result.json"),
    JSON.stringify(completed, null, 2),
  );
  console.log(`WINDOWS_SPEECH_CLI_OK ${root}`);
}
