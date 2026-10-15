import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";

const baseline = "7a3b29f";
const root = process.cwd();
const directory = path.resolve(".cache/renderer-before");
const files = new Set(
  execFileSync(
    "git",
    ["ls-tree", "-r", "--name-only", baseline, "src", "shared"],
    { encoding: "utf8", windowsHide: true },
  )
    .trim()
    .split("\n"),
);
await build({
  plugins: [
    {
      name: "baseline-renderer",
      enforce: "pre",
      load(id) {
        const relative = path
          .relative(root, id.split("?")[0])
          .replaceAll("\\", "/");
        if (files.has(relative) && /\.(tsx?|css)$/.test(relative)) {
          return execFileSync("git", ["show", `${baseline}:${relative}`], {
            encoding: "utf8",
            windowsHide: true,
          });
        }
      },
    },
  ],
  build: { outDir: directory, emptyOutDir: true },
});
const reports = {};
for (const version of ["before", "after"]) {
  const env = { ...process.env };
  delete env.FRAMECRAFT_DEV_URL;
  delete env.ELECTRON_RUN_AS_NODE;
  if (version === "before")
    env.FRAMECRAFT_DEV_URL = pathToFileURL(
      path.join(directory, "index.html"),
    ).href;
  const output = execFileSync(
    process.execPath,
    ["scripts/bench-editor.mjs", "--animation"],
    {
      env,
      encoding: "utf8",
      windowsHide: true,
      timeout: 90000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  reports[version] = JSON.parse(output);
}
const report = {
  recordedAt: new Date().toISOString(),
  baseline,
  ...reports,
  limits:
    "Same-machine synthetic renderer comparison, four text layers and 1000 keyframes per clip. Not video FPS or export throughput.",
};
await fs.writeFile(
  "test-output/ui-comparison.json",
  JSON.stringify(report, null, 2),
);
console.table(
  Object.entries(reports).map(([version, value]) => ({
    version,
    animations: value.mountedAnimations,
    openMs: value.openMs,
    taskMs: value.taskMs,
    taskPercent: (value.taskMs / value.measurementMs) * 100,
    scriptMs: value.scriptMs,
    frameP95Ms: value.timings.p95Ms,
    over33Ms: value.timings.over33Ms,
  })),
);
console.log("完整结果：test-output/ui-comparison.json");
