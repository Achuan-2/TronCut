import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// Explicit input avoids downloading or assuming any particular test recording.
if (!process.argv[2])
  throw new Error("用法：node scripts/verify-asr-gpu.mjs 语音文件");
const root = path.resolve("test-output/asr-gpu");
await fs.mkdir(root, { recursive: true });
const bundle = path.join(root, "services.mjs");
await build({
  stdin: {
    contents: `export { transcribeProject } from './electron/transcription';
      export { createProject, newText } from './shared/model';
      export { probeMedia } from './electron/media';`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: bundle,
});
const { transcribeProject, createProject, newText, probeMedia } = await import(
  pathToFileURL(bundle)
);
const asset = await probeMedia(path.resolve(process.argv[2]));
const project = createProject();
project.assets = [asset];
const starts = [2, asset.duration + 4];
project.clips = starts.map((start, index) => ({
  ...newText(project.tracks[index].id, start),
  assetId: asset.id,
  kind: "audio",
  sourceIn: 0,
  duration: asset.duration,
  text: undefined,
}));
// Reuse only TronCut's own runtime/model cache, just like the application.
const userData =
  process.env.TRONCUT_GPU_TEST_USER_DATA ||
  (process.platform === "win32"
    ? path.join(process.env.APPDATA, "TronCut")
    : path.join(root, "profile"));
const results = {};
for (const device of ["cpu", "cuda"]) {
  const temp = path.join(root, device);
  await fs.mkdir(temp, { recursive: true });
  const start = performance.now();
  let ready;
  const events = [];
  const cues = await transcribeProject(
    project,
    "qwen3-asr",
    "auto",
    {
      device,
      offline: process.env.TRONCUT_GPU_TEST_OFFLINE === "1",
    },
    {
      userData,
      workers: path.resolve("workers/onnx"),
      temp,
      resources: path.resolve("resources"),
    },
    new AbortController().signal,
    (percent, label) => {
      if (percent === 10) ready = performance.now();
      if (percent <= 10 || percent >= 98) console.log(device, percent, label);
      events.push({ percent, label });
    },
  );
  assert(ready, "缺少模型加载完成事件");
  for (const clipStart of starts)
    assert(
      cues.some(
        (cue) =>
          cue.start >= clipStart && cue.end <= clipStart + asset.duration + 0.1,
      ),
      "字幕未保留时间线位置",
    );
  if (device === "cuda")
    assert(events.some((event) => event.label.includes("GPU 已就绪")));
  results[device] = {
    elapsedSeconds: (performance.now() - start) / 1000,
    recognitionSeconds: (performance.now() - ready) / 1000,
    cues,
    events,
  };
}
await fs.writeFile(
  path.join(root, "result.json"),
  JSON.stringify(results, null, 2),
);
console.log(
  "CPU/CUDA 真实全时间线识别通过",
  Object.fromEntries(
    Object.entries(results).map(([device, result]) => [
      device,
      {
        elapsedSeconds: result.elapsedSeconds,
        recognitionSeconds: result.recognitionSeconds,
        cues: result.cues,
      },
    ]),
  ),
);
