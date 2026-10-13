import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { build } from "esbuild";

const file = path.resolve(process.argv[2] ?? "");
if (!process.argv[2] || !(await fs.stat(file)).isFile())
  throw new Error("请传入实际的 .tscproj 文件路径");
const root = path.resolve("test-output/camtasia-import", `run-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const bundle = path.join(root, "importer.cjs");
await build({
  stdin: {
    contents:
      'export { importCamtasia } from "./electron/camtasia"; export { validateProject, projectDuration } from "./shared/model"; export { probeMedia } from "./electron/media";',
    resolveDir: process.cwd(),
    loader: "ts",
  },
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["sharp"],
});
const { importCamtasia, validateProject, projectDuration, probeMedia } =
  createRequire(import.meta.url)(bundle);
const bytes = await fs.readFile(file),
  original = JSON.parse(bytes.toString("utf8"));
const project = importCamtasia(original, file);
const problems = [];
for (let i = 0; i < project.assets.length; i++) {
  const asset = project.assets[i];
  try {
    project.assets[i] = { ...(await probeMedia(asset.path)), id: asset.id };
  } catch (error) {
    asset.missing = true;
    problems.push(
      `离线/解码失败：${asset.name}：${String(error).slice(0, 240)}`,
    );
  }
}
let validation = "通过";
try {
  validateProject(project);
} catch (error) {
  validation = String(error);
}
const histogram = {};
const captionPaths = [];
function visit(value, location = "") {
  if (!value || typeof value !== "object") return;
  if (value._type) histogram[value._type] = (histogram[value._type] ?? 0) + 1;
  for (const [key, item] of Object.entries(value)) {
    const current = `${location}.${key}`;
    if (/caption|subtitle/i.test(key))
      captionPaths.push({
        path: current,
        type: Array.isArray(item) ? "array" : typeof item,
        length: Array.isArray(item) ? item.length : undefined,
      });
    visit(item, current);
  }
}
visit(original);
const flatMedia = original.timeline.sceneTrack.scenes.flatMap((s) =>
  s.csml.tracks.flatMap((t) => t.medias ?? []),
);
const originalEnd = Math.max(
  0,
  ...flatMedia.map(
    (m) =>
      (Number(m.start ?? m._start ?? 0) +
        Number(m.duration ?? m._duration ?? 0)) /
      original.editRate,
  ),
);
const summary = {
  originalFile: file,
  originalSha256: createHash("sha256").update(bytes).digest("hex"),
  validation,
  original: {
    version: original.version,
    canvas: [original.width, original.height],
    fps: original.videoFormatFrameRate,
    sources: original.sourceBin.map((s) => ({ id: s.id, file: s.src })),
    tracks: original.timeline.sceneTrack.scenes.map(
      (s) => s.csml.tracks.length,
    ),
    flatMedia: flatMedia.length,
    duration: originalEnd,
    histogram,
    captionPaths,
  },
  imported: {
    canvas: project.canvas,
    tracks: project.tracks.length,
    assets: project.assets.length,
    clips: project.clips.length,
    duration: projectDuration(project),
    media: project.assets.map((a) => ({
      name: a.name,
      kind: a.kind,
      duration: a.duration,
      missing: !!a.missing,
    })),
    clipKinds: project.clips.reduce(
      (counts, c) => ({ ...counts, [c.kind]: (counts[c.kind] ?? 0) + 1 }),
      {},
    ),
    animatedClips: project.clips.filter((c) => c.keyframes.length).length,
    captionClips: project.clips.filter((c) => c.caption).length,
  },
  report: [...project.importReport, ...problems],
};
await fs.writeFile(
  path.join(root, "summary.json"),
  JSON.stringify(summary, null, 2),
);
await fs.writeFile(
  path.join(root, "converted-debug.json"),
  JSON.stringify(project, null, 2),
);
await fs.writeFile(
  path.resolve("test-output/camtasia-import/latest.json"),
  JSON.stringify({ root, originalFile: file }, null, 2),
);
console.log(JSON.stringify({ root, ...summary }, null, 2));
