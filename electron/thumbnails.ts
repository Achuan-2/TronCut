import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import type { Asset } from "../shared/model";
import { findBinary, runProcess } from "./process";
import { ThumbnailMemoryCache } from "./thumbnail-cache";
import type { AudioWaveform } from "../shared/audio-waveform";
import {
  WaveformPeakBuilder,
  waveformMaxPeaks,
  waveformSampleRate,
} from "./waveform-peaks";

const pending = new Map<string, Promise<string>>();
const memory = new ThumbnailMemoryCache();
const pendingWaveforms = new Map<string, Promise<AudioWaveform>>();

/** Decode once per file revision; zooming only redraws the cached peak envelope. */
export async function mediaWaveform(
  asset: Asset,
  cacheDir: string,
  resourcesPath?: string,
): Promise<AudioWaveform | null> {
  if (asset.missing || !asset.hasAudio) return null;
  const stat = await fs.stat(asset.path);
  const key = createHash("sha256")
    .update(
      `waveform-peaks-v1|${asset.path}|${stat.size}|${stat.mtimeMs}|${asset.duration}`,
    )
    .digest("hex");
  const requestKey = `${path.resolve(cacheDir)}|${key}`;
  const existing = pendingWaveforms.get(requestKey);
  if (existing) return existing;
  const operation = (async () => {
    const release = await acquireSlot();
    try {
      await fs.mkdir(cacheDir, { recursive: true });
      const file = path.join(cacheDir, `${key}.waveform`);
      const cached = await fs
        .readFile(file)
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
          return null;
        });
      const rate = cached && cached.length >= 8 ? cached.readDoubleLE(0) : 0;
      if (
        cached &&
        cached.length <= waveformMaxPeaks + 8 &&
        Number.isFinite(rate) &&
        rate > 0 &&
        rate <= waveformSampleRate / 6
      )
        return {
          peaksPerSecond: rate,
          peaks: new Uint8Array(cached.subarray(8)),
        };
      const builder = new WaveformPeakBuilder(asset.duration);
      await runProcess(
        findBinary("ffmpeg", resourcesPath),
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-i",
          asset.path,
          "-map",
          "0:a:0",
          "-vn",
          "-ac",
          "1",
          "-ar",
          String(waveformSampleRate),
          "-f",
          "f32le",
          "pipe:1",
        ],
        {
          timeout: Math.max(120000, asset.duration * 100),
          onStdout: (chunk) => builder.append(chunk),
        },
      );
      const result = builder.finish();
      const header = Buffer.alloc(8);
      header.writeDoubleLE(result.peaksPerSecond);
      const temp = `${file}.partial`;
      try {
        await fs.writeFile(temp, Buffer.concat([header, result.peaks]));
        await fs.rename(temp, file);
      } finally {
        await fs.rm(temp, { force: true });
      }
      return result;
    } finally {
      release();
    }
  })();
  pendingWaveforms.set(requestKey, operation);
  try {
    return await operation;
  } finally {
    pendingWaveforms.delete(requestKey);
  }
}

// Bounded concurrency pool for thumbnail/waveform generation:
// Instead of strictly serializing all media imports (1 by 1), allow multiple concurrent FFmpeg decoders,
// bounded to prevent CPU and disk thrashing.
const maxConcurrency = Math.max(2, Math.min(4, os.cpus()?.length || 2));
let activeCount = 0;
const waitingQueue: (() => void)[] = [];

async function acquireSlot(): Promise<() => void> {
  if (activeCount < maxConcurrency) {
    activeCount++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      activeCount--;
      const next = waitingQueue.shift();
      if (next) next();
    };
  }
  return new Promise((resolve) => {
    waitingQueue.push(() => {
      activeCount++;
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        activeCount--;
        const next = waitingQueue.shift();
        if (next) next();
      });
    });
  });
}

/** Parallel, bounded-concurrency thumbnail and waveform generation avoids queue starvation on multi-file import. */
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
    .update(
      `${asset.path}|${stat.size}|${stat.mtimeMs}|${waveform}|${asset.kind}|${waveform ? 0 : Math.min(1, asset.duration / 3)}`,
    )
    .digest("hex");
  const cached = memory.get(key);
  if (cached !== undefined) return cached;
  const requestKey = `${path.resolve(cacheDir)}|${key}`;
  if (pending.has(requestKey)) return pending.get(requestKey)!;

  const operation = (async () => {
    const release = await acquireSlot();
    try {
      const existing = memory.get(key);
      if (existing !== undefined) return existing;

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
      const data = `data:image/png;base64,${(await fs.readFile(file)).toString("base64")}`;
      memory.set(key, data);
      return data;
    } finally {
      release();
    }
  })();

  pending.set(requestKey, operation);
  try {
    return await operation;
  } finally {
    pending.delete(requestKey);
  }
}
