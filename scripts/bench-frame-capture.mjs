import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import sharp from "sharp";

// node scripts/bench-frame-capture.mjs --baseline=HEAD --rounds=5
const option = (name, fallback) =>
  process.argv
    .find((arg) => arg.startsWith(`--${name}=`))
    ?.slice(name.length + 3) ?? fallback;
const baseline = option("baseline", "HEAD");
const rounds = Number(option("rounds", "5"));
if (!Number.isInteger(rounds) || rounds < 1)
  throw new Error("rounds 必须为正整数");
const root = path.resolve("test-output/frame-capture-benchmark");
await fs.mkdir(root, { recursive: true });
const require = createRequire(import.meta.url);
const previous = new Map(
  ["export", "loop-image", "cursor-export"].map((name) => [
    name,
    execFileSync("git", ["show", `${baseline}:electron/${name}.ts`], {
      encoding: "utf8",
      windowsHide: true,
    }),
  ]),
);
const engines = {};
for (const version of ["before", "after"]) {
  const outfile = path.join(root, `${version}.cjs`);
  await build({
    stdin: {
      contents: `export * from './electron/export'; export * from './electron/media'; export * from './electron/process'; export * from './shared/model';`,
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
              name: "baseline-frame-capture",
              setup(builder) {
                builder.onLoad(
                  {
                    filter:
                      /[\\/]electron[\\/](export|loop-image|cursor-export)\.ts$/,
                  },
                  ({ path: file }) => ({
                    contents: previous.get(path.basename(file, ".ts")),
                    loader: "ts",
                  }),
                );
              },
            },
          ]
        : [],
  });
  engines[version] = require(outfile);
}
const api = engines.after;
const image = path.join(root, "source.png");
const video = path.join(root, "source.mp4");
await api.runProcess(api.findBinary("ffmpeg"), [
  "-y",
  "-v",
  "error",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=s=3840x2160:r=30",
  "-frames:v",
  "1",
  "-update",
  "1",
  image,
]);
await api.runProcess(api.findBinary("ffmpeg"), [
  "-y",
  "-v",
  "error",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=s=1920x1080:r=30:d=3",
  "-c:v",
  "libx264",
  "-preset",
  "ultrafast",
  "-pix_fmt",
  "yuv420p",
  video,
]);
const results = [];
for (const file of [image, video]) {
  const asset = await api.probeMedia(file);
  for (const height of [1080, 2160]) {
    const name = `${asset.kind}-${height}`;
    const project = api.createProject(name);
    project.canvas = {
      width: (height * 16) / 9,
      height,
      fps: 30,
      background: "#123456",
    };
    project.assets = [asset];
    project.clips = [
      {
        ...api.newText(project.tracks[1].id, 0),
        kind: asset.kind,
        assetId: asset.id,
        duration: 3,
      },
      api.newText(project.tracks[0].id, 0, 0, "截取当前帧"),
    ];
    const timings = { before: [], after: [] },
      hashes = {};
    // Alternate implementations to reduce bias from CPU load and filesystem cache.
    for (let round = -1; round < rounds; round++) {
      for (const version of round % 2 === 0
        ? ["after", "before"]
        : ["before", "after"]) {
        const target = path.join(root, `${name}-${version}.png`);
        const start = performance.now();
        await engines[version].exportFrame(
          project,
          1,
          target,
          path.join(root, `${name}-${version}`),
          new AbortController().signal,
        );
        if (round >= 0) timings[version].push(performance.now() - start);
        const pixels = await sharp(target).raw().toBuffer();
        hashes[version] = createHash("sha256").update(pixels).digest("hex");
      }
    }
    if (hashes.before !== hashes.after)
      throw new Error(`${name} 截帧像素发生变化`);
    const median = (values) =>
      Math.round(
        [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)],
      );
    const before = median(timings.before),
      after = median(timings.after);
    results.push({
      name,
      beforeMs: before,
      afterMs: after,
      improvement: `${Math.round((1 - after / before) * 100)}%`,
      identicalPixels: true,
    });
  }
}
await fs.writeFile(
  path.join(root, "results.json"),
  JSON.stringify({ baseline, rounds, results }, null, 2),
);
console.table(results);
