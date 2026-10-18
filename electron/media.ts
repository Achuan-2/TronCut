import path from "node:path";
import sharp from "sharp";
import { type Asset, uid } from "../shared/model";
import { findBinary, runProcess } from "./process";

export async function probeMedia(
  file: string,
  resourcesPath?: string,
): Promise<Asset> {
  const name = path.basename(file),
    ext = path.extname(file).toLowerCase();
  if (
    [
      ".png",
      ".jpg",
      ".jpeg",
      ".webp",
      ".gif",
      ".tiff",
      ".tif",
      ".bmp",
      ".svg",
    ].includes(ext)
  ) {
    const info = await sharp(file).metadata();
    if (ext === ".gif" && (info.pages ?? 1) > 1) {
      return {
        id: uid(), name, path: file, kind: "video", animated: true,
        duration: Math.max(0.1, (info.delay ?? []).reduce((total, delay) => total + Math.max(10, delay), 0) / 1000),
        width: info.width ?? 1, height: info.pageHeight ?? info.height ?? 1,
        hasAudio: false,
      };
    }
    return {
      id: uid(),
      name,
      path: file,
      kind: "image",
      duration: 5,
      width: info.width ?? 1,
      height: info.height ?? 1,
      hasAudio: false,
    };
  }
  const info = JSON.parse(
    await runProcess(
      findBinary("ffprobe", resourcesPath),
      ["-v", "error", "-show_format", "-show_streams", "-of", "json", file],
      { timeout: 30000 },
    ),
  );
  const video = info.streams.find(
    (s: { codec_type: string; disposition?: { attached_pic?: number } }) =>
      s.codec_type === "video" && !s.disposition?.attached_pic,
  );
  const duration = Number(info.format.duration ?? video?.duration ?? 0);
  if (!Number.isFinite(duration) || duration <= 0)
    throw new Error(`${name} 没有有效时长，可能是尚未结束的录制或不支持的格式`);
  return {
    id: uid(),
    name,
    path: file,
    kind: video ? "video" : "audio",
    duration,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    hasAudio: info.streams.some(
      (s: { codec_type: string }) => s.codec_type === "audio",
    ),
  };
}
export async function capabilities(resourcesPath?: string) {
  try {
    const filters = await runProcess(
      findBinary("ffmpeg", resourcesPath),
      ["-hide_banner", "-filters"],
      { timeout: 10000 },
    );
    await runProcess(findBinary("ffprobe", resourcesPath), ["-version"], {
      timeout: 10000,
    });
    const encoders = await runProcess(
      findBinary("ffmpeg", resourcesPath),
      ["-hide_banner", "-encoders"],
      { timeout: 10000 },
    );
    if (!/\blibx264\b/.test(encoders))
      throw new Error("FFmpeg 缺少 libx264 H.264 编码器，请配置完整媒体引擎");
    return {
      ffmpeg: true,
      rubberband: /\brubberband\b/.test(filters),
      podcast: /\bafftdn\b/.test(filters),
      error: "",
    };
  } catch (err) {
    return {
      ffmpeg: false,
      rubberband: false,
      podcast: false,
      error: String(err),
    };
  }
}
