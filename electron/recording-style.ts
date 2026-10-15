import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { uid } from "../shared/model";
import {
  defaultRecordingSettings,
  recordingBackgrounds,
  recordingSettingsSchema,
  type RecordingBackground,
  type RecordingSettings,
} from "../shared/recording";
import { probeMedia } from "./media";

export class RecordingStyleStore {
  constructor(private readonly root: string) {}
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
  async background(width: number, height: number, preset: RecordingBackground) {
    const folder = path.join(this.root, "recording-backgrounds");
    const file = path.join(folder, `${preset}-${width}x${height}.png`);
    await fs.mkdir(folder, { recursive: true });
    try {
      await fs.access(file);
    } catch {
      const [a, b] = recordingBackgrounds[preset].colors;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
      const temporary = `${file}.${uid()}.tmp`;
      try {
        await sharp(Buffer.from(svg)).png().toFile(temporary);
        await fs.rename(temporary, file);
      } finally {
        await fs.rm(temporary, { force: true });
      }
    }
    return {
      ...(await probeMedia(file)),
      name: `录屏背景 · ${recordingBackgrounds[preset].name}.png`,
    };
  }
}
