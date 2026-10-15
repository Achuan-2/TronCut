import { z } from "zod";

export const videoFormats = {
  mp4: { name: "MP4", description: "H.264 / AAC，适合日常分享" },
  mov: { name: "MOV", description: "H.264 / AAC，QuickTime 容器" },
  mkv: { name: "MKV", description: "H.264 / AAC，Matroska 容器" },
  webm: { name: "WebM", description: "VP9 / Opus，适合网页播放" },
} as const;
export const videoFormatSchema = z.enum(["mp4", "mov", "mkv", "webm"]);
export type VideoFormat = z.infer<typeof videoFormatSchema>;
export const exportResolutions = {
  source: { name: "原画布", width: 0, height: 0 },
  "2160p": { name: "4K", width: 3840, height: 2160 },
  "1440p": { name: "2K", width: 2560, height: 1440 },
  "1080p": { name: "1080p", width: 1920, height: 1080 },
  "720p": { name: "720p", width: 1280, height: 720 },
  "480p": { name: "480p", width: 854, height: 480 },
} as const;
export const exportQualities = {
  high: {
    name: "高质量",
    description: "画面更清晰，文件较大",
    h264: 20,
    vp9: 28,
    audio: "192k",
    mbps: 12,
  },
  standard: {
    name: "标准",
    description: "兼顾画质与文件大小",
    h264: 23,
    vp9: 32,
    audio: "160k",
    mbps: 8,
  },
  compact: {
    name: "小体积",
    description: "文件更小，细节有所减少",
    h264: 28,
    vp9: 38,
    audio: "96k",
    mbps: 4,
  },
} as const;
// Optional additions keep existing projects and CLI plans compatible.
export const exportSettingsSchema = z.object({
  encoder: z.enum(["auto", "software"]),
  format: videoFormatSchema.optional(),
  resolution: z
    .enum(["source", "2160p", "1440p", "1080p", "720p", "480p"])
    .optional(),
  quality: z.enum(["high", "standard", "compact"]).optional(),
});
export type ExportSettings = z.infer<typeof exportSettingsSchema>;
export const defaultExportSettings: Required<ExportSettings> = {
  encoder: "auto",
  format: "mp4",
  resolution: "source",
  quality: "high",
};
export function resolvedExportSettings(
  settings?: ExportSettings,
): Required<ExportSettings> {
  return {
    encoder: settings?.encoder ?? defaultExportSettings.encoder,
    format: settings?.format ?? defaultExportSettings.format,
    resolution: settings?.resolution ?? defaultExportSettings.resolution,
    quality: settings?.quality ?? defaultExportSettings.quality,
  };
}
export function exportDimensions(
  canvas: { width: number; height: number },
  resolution: Required<ExportSettings>["resolution"],
) {
  const preset = exportResolutions[resolution];
  const portrait = canvas.height > canvas.width;
  const ratio =
    resolution === "source"
      ? 1
      : Math.min(
          (portrait ? preset.height : preset.width) / canvas.width,
          (portrait ? preset.width : preset.height) / canvas.height,
        );
  return {
    width: Math.max(2, Math.round((canvas.width * ratio) / 2) * 2),
    height: Math.max(2, Math.round((canvas.height * ratio) / 2) * 2),
  };
}
export const exportFileNameSchema = z
  .string()
  .trim()
  .min(1, "请输入文件名")
  .max(180, "文件名过长")
  .refine(
    (name) =>
      !/[<>:"/\\|?*\x00-\x1f]/.test(name) &&
      !/[. ]$/.test(name) &&
      !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name),
    "文件名包含无效字符或系统保留名称",
  );
export function defaultExportFileName(name: string) {
  const safe = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/[. ]+$/, "")
    .slice(0, 160);
  return exportFileNameSchema.safeParse(safe).success ? safe : "导出视频";
}
export function videoExportFileName(name: string, format: VideoFormat) {
  return `${name.replace(/\.(mp4|mov|mkv|webm)$/i, "")}.${format}`;
}
export const videoExportRequestSchema = z.object({
  directory: z.string().trim().min(1, "请选择导出位置").max(32768),
  fileName: exportFileNameSchema,
  settings: exportSettingsSchema,
});
export type VideoExportRequest = z.infer<typeof videoExportRequestSchema>;
