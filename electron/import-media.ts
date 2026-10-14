import path from "node:path";
import { probeMedia } from "./media";

const mediaExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".tif",
  ".tiff",
  ".bmp",
  ".svg",
  ".mp4",
  ".mov",
  ".mkv",
  ".webm",
  ".avi",
  ".m4v",
  ".mpeg",
  ".mpg",
  ".mts",
  ".m2ts",
  ".wav",
  ".mp3",
  ".m4a",
  ".flac",
  ".ogg",
]);

export async function importMediaPaths(
  files: string[],
  resourcesPath?: string,
) {
  const supported = [...new Set(files)].filter(
    (file) =>
      path.isAbsolute(file) &&
      mediaExtensions.has(path.extname(file).toLowerCase()),
  );
  return Promise.all(supported.map((file) => probeMedia(file, resourcesPath)));
}
