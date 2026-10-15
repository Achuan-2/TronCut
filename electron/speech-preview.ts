import fs from "node:fs/promises";
import path from "node:path";
import type { Asset } from "../shared/model";
import type { TtsOptions } from "../shared/tts";
import { synthesizeSpeech } from "./synthesis";

/** Preview assets are temporary and never added to the editable project. */
export class SpeechVoicePreviews {
  private assets = new Map<string, Asset>();

  async create(
    options: TtsOptions,
    paths: Parameters<typeof synthesizeSpeech>[1],
    signal: AbortSignal,
    progress: Parameters<typeof synthesizeSpeech>[3],
  ) {
    const asset = await synthesizeSpeech(
      {
        ...options,
        text: "你好，这是当前音色的试听。记录灵感，让创作更轻松。",
      },
      paths,
      signal,
      progress,
    );
    const folder = path.dirname(path.resolve(asset.path));
    const root = path.resolve(paths.userData, "narration");
    if (
      path.dirname(folder) !== root ||
      !path.basename(folder).startsWith("speech-")
    )
      throw new Error("试听素材不在临时配音目录中");
    this.assets.set(asset.id, asset);
    return asset;
  }

  async release(id: string) {
    const asset = this.assets.get(id);
    if (!asset) return;
    await fs.rm(path.dirname(asset.path), { recursive: true, force: true });
    this.assets.delete(id);
    return asset;
  }
}
