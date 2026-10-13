import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Asset } from "../shared/model";
import { findBinary, runProcess } from "./process";

const pending = new Map<string, Promise<string>>();
let queue = Promise.resolve();

/** Serial thumbnail generation avoids opening dozens of simultaneous decoders on import. */
export async function mediaThumbnail(
  asset: Asset,
  waveform: boolean,
  cacheDir: string,
  resourcesPath?: string,
): Promise<string | null> {
  if (
    asset.missing ||
    (waveform && !asset.hasAudio) ||
    (!waveform && asset.kind === "audio")
  )
    return null;
  const stat = await fs.stat(asset.path);
  const key = createHash("sha256")
    .update(`${asset.path}|${stat.size}|${stat.mtimeMs}|${waveform}`)
    .digest("hex");
  if (pending.has(key)) return pending.get(key)!;
  const operation = queue.then(async () => {
    await fs.mkdir(cacheDir, { recursive: true });
    const file = path.join(cacheDir, `${key}.png`);
    if (
      !(await fs.access(file).then(
        () => true,
        () => false,
      ))
    ) {
      const temp = path.join(cacheDir, `${key}.partial.png`);
      try {
        const args = ["-y", "-hide_banner"];
        if (!waveform && asset.kind === "video")
          args.push("-ss", String(Math.min(1, asset.duration / 3)));
        args.push("-i", asset.path);
        if (waveform)
          args.push(
            "-filter_complex",
            "aformat=channel_layouts=mono,aresample=1000,showwavespic=s=1200x64:colors=0x71e6b5:scale=sqrt:filter=peak",
            "-an",
          );
        else
          args.push(
            "-vf",
            "scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2:color=0x142821",
            "-an",
          );
        args.push("-frames:v", "1", temp);
        await runProcess(findBinary("ffmpeg", resourcesPath), args, {
          timeout: 120000,
        });
        await fs.rename(temp, file);
      } finally {
        await fs.rm(temp, { force: true });
      }
    }
    return `data:image/png;base64,${(await fs.readFile(file)).toString("base64")}`;
  });
  pending.set(key, operation);
  queue = operation.then(
    () => {},
    () => {},
  );
  try {
    return await operation;
  } finally {
    pending.delete(key);
  }
}
