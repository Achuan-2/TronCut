import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import "./build-rust.mjs";

// This commit introduced the first Rust query engine, before hot-path changes.
const baseline = "7a3b29f";
const directory = path.resolve(".cache/hotpaths-benchmark");
await fs.mkdir(directory, { recursive: true });
const sources = new Map(
  ["shared/editor.ts", "shared/transitions.ts"].map((file) => {
    let source = execFileSync("git", ["show", `${baseline}:${file}`], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (file.endsWith("editor.ts"))
      source +=
        "\nexport const createTransformSampler = (clip) => (time) => transformAt(clip, time);\n";
    return [path.resolve(file).replaceAll("\\", "/"), source];
  }),
);
const results = {};
for (const version of ["before", "after"]) {
  const outfile = path.join(directory, `${version}.mjs`);
  await build({
    entryPoints: ["scripts/bench-hotpaths-entry.ts"],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    plugins:
      version === "before"
        ? [
            {
              name: "baseline-sources",
              setup(builder) {
                builder.onLoad({ filter: /\.(ts|tsx)$/ }, (args) => {
                  const contents = sources.get(args.path.replaceAll("\\", "/"));
                  if (contents !== undefined) return { contents, loader: "ts" };
                });
              },
            },
          ]
        : [],
  });
  const { benchmarkHotpaths } = await import(pathToFileURL(outfile).href);
  results[version] = benchmarkHotpaths();
}
assert.deepEqual(results.after.verification, results.before.verification);
const rows = (kind, field) =>
  results.after[kind].map((value, i) => ({
    size: value[kind === "animation" ? "keyframes" : "clips"],
    beforeMs: Number(results.before[kind][i][field].toFixed(4)),
    afterMs: Number(value[field].toFixed(4)),
    speedup: Number((results.before[kind][i][field] / value[field]).toFixed(2)),
  }));
const report = {
  recordedAt: new Date().toISOString(),
  cpu: os.cpus()[0]?.model,
  node: process.version,
  baseline,
  outputParity: true,
  animationSampling: rows("animation", "p95Ms"),
  transitionPreparation: rows("transitions", "normalizeMs"),
  transitionQueries: rows("transitions", "p95Ms"),
  preparation: results.after.animation.map(({ keyframes, prepareMs }) => ({
    keyframes,
    prepareMs,
  })),
  limits:
    "Synthetic animation and transition algorithms, not video decode or export throughput.",
};
await fs.mkdir("test-output", { recursive: true });
await fs.writeFile(
  "test-output/hotpaths-benchmark.json",
  JSON.stringify(report, null, 2),
);
for (const name of [
  "animationSampling",
  "transitionPreparation",
  "transitionQueries",
]) {
  console.log(name);
  console.table(report[name]);
}
console.log("输出与原实现逐项一致；结果：test-output/hotpaths-benchmark.json");
