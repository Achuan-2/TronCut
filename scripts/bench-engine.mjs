import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import "./build-rust.mjs";

const directory = path.resolve(".cache/engine-benchmark");
await fs.mkdir(directory, { recursive: true });
const outfile = path.join(directory, "benchmark.mjs");
await build({
  entryPoints: ["scripts/bench-engine-entry.ts"],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
});
const { benchmarkEngine } = await import(pathToFileURL(outfile).href);
const report = benchmarkEngine();
await fs.mkdir("test-output", { recursive: true });
await fs.writeFile(
  "test-output/engine-benchmark.json",
  JSON.stringify(report, null, 2),
);
console.table(report.cases);
console.log(
  "查询耗时包含 JS/Wasm 边界及结果复制；完整结果：test-output/engine-benchmark.json",
);
