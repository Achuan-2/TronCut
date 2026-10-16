import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// Example: pnpm bench:export --baseline=<commit> --seconds=5 --rounds=2
const option = (name, fallback) =>
  process.argv
    .find((arg) => arg.startsWith(`--${name}=`))
    ?.split("=")
    .slice(1)
    .join("=") ?? fallback;
const baseline = option("baseline", "f8ee87d3cdcafa8fef2561ec22b91352980e1e9a");
const seconds = Number(option("seconds", "5"));
const rounds = Number(option("rounds", "2"));
const timeout = Number(option("timeout", "120000"));
if (
  !Number.isFinite(seconds) ||
  seconds < 3 ||
  !Number.isInteger(rounds) ||
  rounds < 1 ||
  !Number.isInteger(timeout) ||
  timeout < 1000
)
  throw new Error(
    "seconds 必须 >= 3，rounds 必须为正整数，timeout 必须为 >= 1000 的整数毫秒",
  );
const root = path.resolve("test-output/export-benchmark");
await fs.mkdir(root, { recursive: true });
const baselineSource = execFileSync(
  "git",
  ["show", `${baseline}:electron/export.ts`],
  { encoding: "utf8", windowsHide: true },
);
const engines = {};
for (const version of ["before", "after"]) {
  const outfile = path.join(root, `${version}.cjs`);
  await build({
    stdin: {
      contents: `export * from './electron/export'; export * from './electron/media'; export * from './electron/process'; export * from './electron/recording-style'; export * from './shared/model'; export * from './shared/recording';`,
      resolveDir: process.cwd(),
    },
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    packages: "external",
    plugins:
      version === "before"
        ? [
            {
              name: "baseline-export",
              setup(builder) {
                builder.onLoad(
                  { filter: /[\\/]electron[\\/]export\.ts$/ },
                  () => ({ contents: baselineSource, loader: "ts" }),
                );
              },
            },
          ]
        : [],
  });
  engines[version] = (await import(pathToFileURL(outfile).href)).default;
}
const api = engines.after;
const ffmpeg = api.findBinary("ffmpeg");
const source = path.join(root, "source.mp4");
await api.runProcess(ffmpeg, [
  "-y",
  "-v",
  "error",
  "-f",
  "lavfi",
  "-i",
  `testsrc2=s=1920x1080:r=30:d=${seconds}`,
  "-f",
  "lavfi",
  "-i",
  `sine=frequency=440:duration=${seconds}`,
  "-c:v",
  "libx264",
  "-preset",
  "ultrafast",
  "-crf",
  "18",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  source,
]);
const asset = await api.probeMedia(source);
asset.cursor = {
  samples: Array.from({ length: Math.ceil(seconds * 30) }, (_, i) => ({
    time: i / 30,
    x: 0.3 + (0.35 * i) / (seconds * 30),
    y: 0.5,
    visible: true,
    click: i === 30 || i === 75,
  })),
};
const store = new api.RecordingStyleStore(path.join(root, "profile"));
const cases = [];
for (const [name, preset, radius] of [
  ["default-recording", "perspective-grid", 0],
  ["rounded-recording", "violet", 24],
]) {
  const project = api.createProject(name);
  project.canvas = {
    width: 1920,
    height: 1080,
    fps: 30,
    background: "#101319",
  };
  project.exportSettings = { encoder: option("encoder", "auto") };
  const settings = { ...api.defaultRecordingSettings, preset, radius };
  const background = await store.background(1920, 1080, preset);
  const recording = api.addRecordedAssets(
    project,
    [{ asset, kind: "screen" }],
    settings,
    0,
    background,
  );
  // Keep this historical benchmark stable when recorder UI units/defaults change.
  // Existing projects may still contain pixel-based frames.
  const screen = recording.clips.find(
    (clip) => clip.recordingRole === "screen",
  );
  if (screen?.mediaFrame) screen.mediaFrame = { radius, unit: "px" };
  cases.push({
    name,
    project: recording,
  });
}
const results = [];
for (const { name, project } of cases) {
  const samples = { before: [], after: [] };
  const failures = {};
  for (let round = 0; round < rounds; round++) {
    // Alternate ordering to reduce cache and thermal bias.
    for (const version of round % 2
      ? ["after", "before"]
      : ["before", "after"]) {
      if (failures[version]) continue;
      const start = performance.now();
      try {
        await engines[version].exportVideo(
          project,
          path.join(root, `${name}-${version}.mp4`),
          path.join(root, `${name}-${version}`),
          false,
          AbortSignal.timeout(timeout),
          () => {},
        );
      } catch (error) {
        failures[version] = {
          elapsedMs: performance.now() - start,
          error: String(error),
        };
        console.log(`${name} ${version}: ${JSON.stringify(failures[version])}`);
        continue;
      }
      const elapsed = performance.now() - start;
      samples[version].push(elapsed);
      console.log(
        `${name} ${version} round ${round + 1}: ${(elapsed / 1000).toFixed(2)}s`,
      );
    }
  }
  const mean = (values) =>
    values.length
      ? values.reduce((sum, n) => sum + n, 0) / values.length
      : null;
  // Compare decoded frames, including zoom and frame edges, using FFmpeg SSIM.
  const comparison = path.join(root, `${name}-ssim.log`);
  let scores = [];
  if (!failures.before && !failures.after) {
    await api.runProcess(
      ffmpeg,
      [
        "-y",
        "-v",
        "error",
        "-i",
        path.join(root, `${name}-before.mp4`),
        "-i",
        path.join(root, `${name}-after.mp4`),
        "-lavfi",
        "[0:v][1:v]ssim=stats_file=ssim.log",
        "-an",
        "-f",
        "null",
        "-",
      ],
      { cwd: root, timeout },
    );
    await fs.rename(path.join(root, "ssim.log"), comparison);
    scores = [
      ...(await fs.readFile(comparison, "utf8")).matchAll(/All:([\d.]+)/g),
    ].map((match) => Number(match[1]));
  }
  const metadata = failures.after
    ? null
    : await api.probeMedia(path.join(root, `${name}-after.mp4`));
  const row = {
    name,
    samples,
    failures,
    beforeMs: mean(samples.before),
    afterMs: mean(samples.after),
    speedup:
      !failures.before && !failures.after
        ? mean(samples.before) / mean(samples.after)
        : null,
    meanSsim: mean(scores),
    comparedFrames: scores.length,
    output: metadata && {
      duration: metadata.duration,
      width: metadata.width,
      height: metadata.height,
      hasAudio: metadata.hasAudio,
    },
  };
  results.push(row);
  console.log(JSON.stringify(row));
}
const report = {
  recordedAt: new Date().toISOString(),
  cpu: os.cpus()[0]?.model,
  baseline,
  seconds,
  rounds,
  encoder: option("encoder", "auto"),
  results,
  limits:
    "Synthetic 1080p recordings with cursor, auto zoom, background and audio; includes encoder probing and output finalization. Does not establish throughput for user projects, 4K or long recordings.",
};
await fs.writeFile(
  path.join(root, "report.json"),
  JSON.stringify(report, null, 2),
);
