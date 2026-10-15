import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(`test-output/lux-tts/${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const bundle = path.join(root, "services.mjs");
await build({
  stdin: {
    contents: `export { ClonedVoices } from './electron/cloned-voices';
    export { synthesizeSpeech } from './electron/synthesis';
    export { closeOnnxSessions } from './electron/onnx-session';
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
  ClonedVoices,
  synthesizeSpeech,
  closeOnnxSessions,
  saveProject,
  openProject,
  createProject,
  transcribeAsset,
} = await import(pathToFileURL(bundle));
const paths = {
  userData: path.resolve(
    process.env.TRONCUT_LUX_TEST_USER_DATA ?? path.join(root, "profile"),
  ),
  workers: path.resolve("workers/onnx"),
  resources: path.resolve("resources"),
};
const signal = new AbortController().signal;
const logs = [];
const progress = (percent, label) => {
  logs.push(label);
  if (percent <= 15 || percent >= 90) console.log(Math.round(percent), label);
};
const store = new ClonedVoices(paths.userData);
let voice;
try {
  const text = "欢迎使用本地语音模型。现在可以保存音色，生成自己的旁白。";
  const reference = await synthesizeSpeech(
    { engine: "kokoro-onnx", voice: "10", text },
    paths,
    signal,
    progress,
  );
  await fs.copyFile(reference.path, path.join(root, "reference.wav"));
  assert.ok(reference.duration >= 3 && reference.duration <= 30);
  voice = await store.create(
    {
      name: "验证音色 · LuxTTS",
      referenceAssetId: reference.id,
      transcript: text,
    },
    reference,
    paths,
    signal,
    progress,
  );
  const saved = await new ClonedVoices(paths.userData).get(voice.id);
  assert.equal(saved.voice.name, voice.name);
  assert.ok((await fs.stat(saved.prompt)).size > 0);
  assert.ok((await store.list()).some((item) => item.id === voice.id));
  // The persistent voice owns its reference; the temporary source can disappear.
  await fs.rm(path.dirname(reference.path), { recursive: true, force: true });
  const results = [];
  for (let index = 0; index < 2; index++) {
    const started = performance.now();
    const asset = await synthesizeSpeech(
      {
        engine: "lux-onnx",
        voice: voice.id,
        text: "你好，这是保存音色后的克隆配音。",
        offline: true,
        speed: 1.25,
      },
      paths,
      signal,
      progress,
    );
    const metadata = JSON.parse(
      await fs.readFile(
        path.join(path.dirname(asset.path), "narration.json"),
        "utf8",
      ),
    );
    assert.equal(metadata.runtime.modelCached, true);
    assert.equal(metadata.runtime.loadSeconds, 0);
    assert.equal(metadata.runtime.sampleRate, 48000);
    assert.ok(
      Math.abs(asset.duration * 1.25 - metadata.runtime.duration) < 0.15,
    );
    results.push({
      seconds: (performance.now() - started) / 1000,
      asset,
      runtime: metadata.runtime,
    });
  }
  const asrTemp = await fs.mkdtemp(path.join(root, "asr-"));
  const recognized = await transcribeAsset(
    results[0].asset,
    "sensevoice",
    "zh",
    { offline: true },
    { ...paths, temp: asrTemp },
    signal,
    progress,
  );
  const recognizedText = recognized.map((cue) => cue.text).join("");
  assert.match(recognizedText, /保存音色/);
  assert.match(recognizedText, /配音/);
  await closeOnnxSessions();
  const reopenedVoice = await new ClonedVoices(paths.userData).get(voice.id);
  assert.equal(reopenedVoice.voice.id, voice.id);
  const restarted = await synthesizeSpeech(
    {
      engine: "lux-onnx",
      voice: voice.id,
      text: "重新打开后，仍然可以使用这个音色。",
      offline: true,
    },
    paths,
    signal,
    progress,
  );
  const runtime = JSON.parse(
    await fs.readFile(
      path.join(path.dirname(restarted.path), "narration.json"),
      "utf8",
    ),
  ).runtime;
  assert.equal(runtime.modelCached, false);
  const project = createProject();
  project.assets = [results[0].asset];
  const file = path.join(root, "saved/克隆配音.troncut");
  await saveProject(project, file);
  await store.remove(voice.id);
  const reopened = await openProject(file);
  assert.equal(reopened.assets[0].missing, false);
  assert.equal(reopened.assets[0].narration.voice, voice.id);
  await fs.writeFile(
    path.join(root, "result.json"),
    JSON.stringify(
      {
        voice,
        results,
        recognized,
        restarted: runtime,
        projectFile: file,
        logs,
      },
      null,
      2,
    ),
  );
  console.log(
    "LuxTTS ONNX 创建音色、缓存配音、进程重启、音色删除后工程播放通过：",
    root,
  );
} finally {
  await closeOnnxSessions();
  if (voice) await store.remove(voice.id).catch(() => {});
}
