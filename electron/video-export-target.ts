import fs from "node:fs/promises";
import path from "node:path";
import type { Project } from "../shared/model";
import {
  resolvedExportSettings,
  videoExportFileName,
  videoExportRequestSchema,
  type VideoExportRequest,
} from "../shared/export-settings";

export function videoExportTarget(request: VideoExportRequest) {
  const options = videoExportRequestSchema.parse(request);
  if (!path.isAbsolute(options.directory))
    throw new Error("导出位置必须是完整文件夹路径");
  return path.join(
    options.directory,
    videoExportFileName(
      options.fileName,
      resolvedExportSettings(options.settings).format,
    ),
  );
}

/** Resolve aliases as well as Windows path casing before permitting replacement. */
export async function assertExportTarget(
  project: Project,
  target: string,
  projectFile?: string | null,
) {
  const canonical = async (file: string) => {
    const resolved = await fs
      .realpath(file)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
        return path.resolve(file);
      });
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  const output = await canonical(target);
  const protectedFiles = project.assets.flatMap((asset) => [
    asset.path,
    ...(asset.cursorPath ? [asset.cursorPath] : []),
  ]);
  if (projectFile) protectedFiles.push(projectFile);
  if ((await Promise.all(protectedFiles.map(canonical))).includes(output))
    throw new Error("导出目标不能覆盖项目文件或源素材，请更换文件名或导出位置");
}
