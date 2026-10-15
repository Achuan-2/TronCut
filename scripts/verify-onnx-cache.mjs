import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(`test-output/onnx-cache/${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const bundle = path.join(root, "services.mjs");
await build({
  stdin: {
    contents: `export { synthesizeSpeech } from './electron/synthesis';
      export { SpeechVoicePreviews } from './electron/speech-preview';
      export { transcribeAsset } from './electron/transcription';
      export { probeMedia } from './electron/media';
      export { closeOnnxSessions } from './electron/onnx-session';`,
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
  SpeechVoicePreviews,
  transcribeAsset,
  probeMedia,
  closeOnnxSessions,
} = await import(pathToFileURL(bundle));
const paths = {
  userData: path.resolve(
    process.env.TRONCUT_CACHE_TEST_USER_DATA ?? path.join(root, "profile"),
  ),
  workers: path.resolve("workers/onnx"),
  resources: path.resolve("resources"),
};
const signal = new AbortController().signal;
const logs = [];
const progress = (_percent, label) => {
  logs.push(label);
};
const timings = [];
const previews = new SpeechVoicePreviews();
const options = {
  engine: "kokoro-onnx",
  voice: "10",
  offline: true,
  text: "欢迎使用本地语音模型。",
};
const assets = [];
try {
  for (const [label, operation] of [
    ["首次试听", () => previews.create(options, paths, signal, progress)],
    ["重复试听", () => previews.create(options, paths, signal, progress)],
    [
      "更换音色",
      () =>
        previews.create({ ...options, voice: "11" }, paths, signal, progress),
    ],
    ["正式配音", () => synthesizeSpeech(options, paths, signal, progress)],
  ]) {
    const started = performance.now();
    const asset = await operation();
    assets.push(asset);
    const metadata = JSON.parse(
      await fs.readFile(
        path.join(path.dirname(asset.path), "narration.json"),
        "utf8",
      ),
    );
    const cached = timings.length > 0;
    assert.equal(metadata.runtime.modelCached, cached);
    if (cached) assert.equal(metadata.runtime.loadSeconds, 0);
    assert.ok(asset.duration > 0);
    timings.push({
      label,
      seconds: (performance.now() - started) / 1000,
      runtime: metadata.runtime,
    });
    console.log(
      label,
      timings.at(-1).seconds.toFixed(2),
      "s",
      "cached:",
      cached,
    );
  }
  const input = path.resolve(
    process.env.TRONCUT_CACHE_TEST_AUDIO ?? "test-output/sensevoice-zh.wav",
  );
  const source = await probeMedia(input, paths.resources);
  for (const engine of ["qwen3-asr", "sensevoice"]) {
    let first;
    for (let iteration = 0; iteration < 2; iteration++) {
      const temp = await fs.mkdtemp(path.join(root, "asr-"));
      const offset = logs.length;
      const started = performance.now();
      const cues = await transcribeAsset(
        source,
        engine,
        "zh",
        { device: "cpu", offline: true },
        { ...paths, temp },
        signal,
        progress,
      );
      assert.ok(cues.length > 0);
      const reused = logs
        .slice(offset)
        .some((line) => line.includes(`复用已加载的 ${engine}`));
      assert.equal(reused, iteration > 0);
      if (first)
        assert.deepEqual(
          cues,
          first,
          "VAD 在下一次任务重置，不能累积时间或字幕",
        );
      first = cues;
      timings.push({
        label: `${engine} ${iteration ? "缓存" : "首次"}`,
        seconds: (performance.now() - started) / 1000,
        reused,
        cues,
      });
      console.log(timings.at(-1).label, timings.at(-1).seconds.toFixed(2), "s");
    }
  }
  // Interleaving ASR must not discard the loaded TTS model.
  const afterAsr = await synthesizeSpeech(options, paths, signal, progress);
  assets.push(afterAsr);
  const after = JSON.parse(
    await fs.readFile(
      path.join(path.dirname(afterAsr.path), "narration.json"),
      "utf8",
    ),
  );
  assert.equal(after.runtime.modelCached, true);
  await fs.writeFile(
    path.join(root, "result.json"),
    JSON.stringify({ timings, afterAsr: after.runtime, logs }, null, 2),
  );
  console.log("真实 ONNX 缓存验证通过：", root);
} finally {
  await closeOnnxSessions();
  for (const asset of assets.slice(0, 3)) await previews.release(asset.id);
}
