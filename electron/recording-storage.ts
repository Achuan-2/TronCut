import fs from "node:fs/promises";
import path from "node:path";
import { resolveContained } from "./project-store";

/** Capture directly into the project archive; never fall back to app-data storage. */
export async function projectRecordingDirectory(
  file: string | null,
): Promise<string> {
  if (!file) throw new Error("请先新建或保存项目，再开始录制");
  const root = path.dirname(path.resolve(file));
  const directory = path.join(root, "media");
  await fs.mkdir(directory, { recursive: true });
  const realRoot = await fs.realpath(root);
  resolveContained(
    realRoot,
    path.relative(realRoot, await fs.realpath(directory)),
  );
  return directory;
}
