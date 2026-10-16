import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { uid, type Asset } from "../shared/model";
import { customRecordingBackgroundSchema } from "../shared/recording-settings";
import {
  defaultRecordingSettings,
  recordingBackgrounds,
  recordingSettingsSchema,
  type RecordingBackground,
  type RecordingSettings,
} from "../shared/recording";
import { probeMedia } from "./media";

export class RecordingStyleStore {
  constructor(
    private readonly root: string,
    private readonly wallpaperRoot = path.resolve(
      "public/recording/wallpapers",
    ),
    private readonly resourcesPath?: string,
  ) {}
  async read(): Promise<RecordingSettings> {
    try {
      return recordingSettingsSchema.parse(
        JSON.parse(
          await fs.readFile(
            path.join(this.root, "recording-settings.json"),
            "utf8",
          ),
        ),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return structuredClone(defaultRecordingSettings);
      throw new Error("读取录屏美化设置失败，请检查 recording-settings.json", {
        cause: error,
      });
    }
  }
  async save(input: RecordingSettings) {
    const settings = recordingSettingsSchema.parse(input);
    await fs.mkdir(this.root, { recursive: true });
    const target = path.join(this.root, "recording-settings.json"),
      temporary = `${target}.${uid()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(settings), "utf8");
      await fs.rename(temporary, target);
    } finally {
      await fs.rm(temporary, { force: true });
    }
    return settings;
  }
  async importBackground(source: string) {
    const asset = await probeMedia(source, this.resourcesPath);
    if (asset.kind === "audio") throw new Error("背景仅支持图片或视频，请重新选择文件");
    const custom = customRecordingBackgroundSchema.parse(asset);
    const folder = path.join(this.root, "recording-backgrounds", "custom");
    await fs.mkdir(folder, { recursive: true });
    const target = path.join(
      folder,
      `${custom.id}${path.extname(source).toLowerCase()}`,
    );
    try {
      await fs.copyFile(source, target);
    } catch (error) {
      await fs.rm(target, { force: true });
      throw error;
    }
    return { ...custom, path: target };
  }
  async background(
    width: number,
    height: number,
    preset: RecordingBackground,
    custom?: Asset,
  ) {
    if (preset === "custom") {
      if (!custom) throw new Error("请先选择自定义背景图片或视频");
      const asset = customRecordingBackgroundSchema.parse(custom);
      await fs.access(asset.path);
      return asset;
    }
    const entry = recordingBackgrounds[preset];
    if ("file" in entry && !entry.file.endsWith(".svg")) {
      // External FFprobe/FFmpeg cannot open media inside app.asar.
      const folder = path.join(this.root, "recording-backgrounds");
      await fs.mkdir(folder, { recursive: true });
      const file = path.join(folder, entry.file);
      try {
        await fs.access(file);
      } catch {
        await fs.copyFile(path.join(this.wallpaperRoot, entry.file), file);
      }
      return {
        ...(await probeMedia(file, this.resourcesPath)),
        name: `录屏背景 · ${entry.name}`,
      };
    }
    const folder = path.join(this.root, "recording-backgrounds");
    const file = path.join(folder, `${preset}-${width}x${height}.png`);
    await fs.mkdir(folder, { recursive: true });
    try {
      await fs.access(file);
    } catch {
      // Rasterize vector backgrounds at the canvas size so archived projects and
      // FFmpeg exports do not depend on an SVG decoder.
      const svg =
        "file" in entry
          ? await fs.readFile(path.join(this.wallpaperRoot, entry.file))
          : Buffer.from(
              `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${entry.colors[0]}"/><stop offset="1" stop-color="${entry.colors[1]}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`,
            );
      const temporary = `${file}.${uid()}.tmp`;
      try {
        await sharp(svg)
          .resize(width, height, { fit: "cover" })
          .png()
          .toFile(temporary);
        await fs.rename(temporary, file);
      } finally {
        await fs.rm(temporary, { force: true });
      }
    }
    return {
      ...(await probeMedia(file, this.resourcesPath)),
      name: `录屏背景 · ${recordingBackgrounds[preset].name}.png`,
    };
  }
}
