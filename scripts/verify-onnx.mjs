import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// Optional explicit directories allow verification with existing models. Empty uses
// TronCut's own cache/download flow, exactly as the desktop application does.
const root = path.resolve("test-output/onnx-integration");
await fs.mkdir(root, { recursive: true });
const bundle = path.join(root, "services.mjs");
await build({
  stdin: {
    contents: `export { synthesizeSpeech } from './electron/synthesis';
      export { downloadOnnxModel } from './electron/onnx';
      export { transcribeAsset } from './electron/transcription';
      export { saveProject, openProject } from './electron/project-store';
      export { createProject } from './shared/model';`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: bundle,
});
const {
  synthesizeSpeech,
  downloadOnnxModel,
  transcribeAsset,
  saveProject,
  openProject,
  createProject,
} = await import(pathToFileURL(bundle));
const paths = {
  userData: path.join(root, "profile"),
  workers: path.resolve("workers/onnx"),
  resources: path.resolve("resources"),
};
const progress = (percent, label) => {
  if (percent === 0 || percent >= 95 || label.includes("模型："))
    console.log(`${Math.round(percent)}% ${label}`);
};
const signal = new AbortController().signal;
if (process.env.TRONCUT_TEST_DOWNLOAD === "1") {
  const temp = await fs.mkdtemp(path.join(root, "download-"));
  const downloaded = await downloadOnnxModel(
    "vits-onnx",
    { ...paths, temp },
    signal,
    progress,
  );
  assert.equal(downloaded.engine, "vits-onnx");
  const speech = await synthesizeSpeech(
    {
      engine: "vits-onnx",
      voice: "0",
      text: "这是自动下载模型后的中文语音。",
      offline: true,
    },
    paths,
    signal,
    progress,
  );
  assert.ok(speech.duration > 0);
  console.log(`下载、完整解压与离线推理通过：${downloaded.directory}`);
  if (process.env.TRONCUT_TEST_DOWNLOAD_ONLY === "1") process.exit(0);
}
const asset = await synthesizeSpeech(
  {
    engine: "kokoro-onnx",
    voice: "10",
    text: "欢迎使用本地语音模型。现在可以生成配音和字幕。",
    speed: 1.25,
    modelDir: process.env.TRONCUT_TEST_KOKORO_DIR ?? "",
  },
  paths,
  signal,
  progress,
);
assert.equal(asset.kind, "audio");
assert.ok(asset.duration > 0);
const metadata = JSON.parse(
  await fs.readFile(
    path.join(path.dirname(asset.path), "narration.json"),
    "utf8",
  ),
);
assert.equal(metadata.runtime.device, "cpu");
assert.equal(metadata.runtime.precision, "int8");
assert.ok(
  Math.abs(asset.duration * 1.25 - metadata.runtime.duration) < 0.15,
  "语速只应用一次",
);
const temp = await fs.mkdtemp(path.join(root, "asr-"));
const transcripts = {};
for (const engine of ["qwen3-asr", "sensevoice"]) {
  const cues = await transcribeAsset(
    asset,
    engine,
    "zh",
    {
      modelDir:
        process.env[
          engine === "sensevoice"
            ? "TRONCUT_TEST_SENSEVOICE_DIR"
            : "TRONCUT_TEST_QWEN3_ASR_DIR"
        ] ?? "",
    },
    { ...paths, temp },
    signal,
    progress,
  );
  assert.ok(cues.length > 0);
  assert.ok(
    cues.every(
      (cue) =>
        cue.start >= 0 && cue.end > cue.start && cue.end <= asset.duration,
    ),
  );
  assert.match(cues.map((cue) => cue.text).join(""), /语音模型/);
  transcripts[engine] = cues;
}
const project = createProject();
project.assets = [asset];
const projectFile = path.join(root, "saved/ONNX配音.troncut");
await saveProject(project, projectFile);
const reopened = await openProject(projectFile);
assert.deepEqual(reopened.assets[0].narration, asset.narration);
assert.deepEqual(
  await fs.readFile(reopened.assets[0].path),
  await fs.readFile(asset.path),
);
// A prepared runtime and explicit model can be used without any dependency/model request.
const offline = await synthesizeSpeech(
  { ...asset.narration, offline: true },
  paths,
  signal,
  progress,
);
assert.ok(offline.duration > 0);
const result = {
  duration: asset.duration,
  metadata,
  transcripts,
  projectFile,
  offlineDuration: offline.duration,
};
await fs.writeFile(
  path.join(root, "result.json"),
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
