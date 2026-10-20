import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import type { Asset } from "../shared/model";
import { normalizedLoudness, normalizedTruePeak } from "../shared/loudness";
import { findBinary, runProcess } from "./process";

let cacheDirectory = path.join(os.tmpdir(), "troncut-normalized-audio");
const pending = new Map<string, Promise<Asset>>();
const queue: (() => void)[] = [];
let active = 0;

export function setLoudnessCacheDirectory(directory: string) {
  cacheDirectory = directory;
}

async function acquireSlot() {
  if (active < 2) active++;
  else await new Promise<void>((resolve) => queue.push(resolve));
  return () => {
    const next = queue.shift();
    if (next) next();
    else active--;
  };
}

export function parseLoudnessMeasurement(output: string) {
  const json = output.match(/\{\s*"input_i"[\s\S]*?\}/g)?.at(-1);
  if (!json) throw new Error("无法读取音频响度测量结果");
  const data = JSON.parse(json) as Record<string, string>;
  const values = {
    integrated: data.input_i === "-inf" ? -Infinity : Number(data.input_i),
    peak: Number(data.input_tp),
    range: Number(data.input_lra),
    threshold: Number(data.input_thresh),
    offset: Number(data.target_offset),
  };
  // Silence has -inf integrated loudness. Preserve silence without generating
  // invalid filter arguments or amplifying the numerical noise floor.
  if (values.integrated === -Infinity) return null;
  if (Object.values(values).some((value) => !Number.isFinite(value)))
    throw new Error("音频响度测量结果无效");
  return values;
}

function waitFor<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) return Promise.reject(new Error("任务已取消"));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("任务已取消"));
    signal.addEventListener("abort", abort, { once: true });
    operation
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Full-source normalization preserves edit timing and clip volume automation.
 * Preview and every export path use this same immutable processed audio. */
export async function prepareNormalizedAudio(
  asset: Asset,
  podcast: boolean,
  resources?: string,
  signal?: AbortSignal,
): Promise<Asset> {
  signal?.throwIfAborted();
  if (!asset.hasAudio || asset.missing || asset.duration <= 0)
    throw new Error(`素材没有可处理的声音：${asset.name}`);
  const stat = await fs.stat(asset.path);
  const key = createHash("sha256")
    .update(
      `loudness-v1|${asset.path}|${stat.size}|${stat.mtimeMs}|${asset.duration}|${podcast}|${normalizedLoudness}|${normalizedTruePeak}`,
    )
    .digest("hex");
  const directory = cacheDirectory;
  const file = path.join(directory, `${key}.m4a`);
  const result: Asset = {
    id: `loudness-${key}`,
    name: asset.name,
    path: file,
    kind: "audio",
    width: 0,
    height: 0,
    duration: asset.duration,
    hasAudio: true,
  };
  const requestKey = `${directory}|${key}`;
  const existing = pending.get(requestKey);
  if (existing) return waitFor(existing, signal);
  const operation = (async () => {
    if (
      await fs.access(file).then(
        () => true,
        () => false,
      )
    )
      return result;
    const release = await acquireSlot();
    const temporary = path.join(
      directory,
      `${key}.${randomUUID()}.partial.m4a`,
    );
    try {
      await fs.mkdir(directory, { recursive: true });
      const binary = findBinary("ffmpeg", resources);
      const processing = podcast
        ? [
            "highpass=f=80",
            "afftdn=nf=-25",
            "equalizer=f=3000:t=q:w=1:g=2",
            "acompressor=threshold=0.125:ratio=3:attack=5:release=100",
          ]
        : [];
      processing.push("aformat=channel_layouts=stereo");
      const target = `loudnorm=I=${normalizedLoudness}:TP=${normalizedTruePeak}:LRA=50`;
      const input = [
        "-hide_banner",
        "-nostats",
        "-threads",
        "1",
        "-i",
        asset.path,
        "-map",
        "0:a:0",
        "-vn",
      ];
      const timeout = Math.max(120000, asset.duration * 1000);
      let measurement = "";
      await runProcess(
        binary,
        [
          ...input,
          "-af",
          [...processing, `${target}:print_format=json`].join(","),
          "-f",
          "null",
          "-",
        ],
        {
          timeout,
          onStderr: (text) => {
            measurement = (measurement + text).slice(-16000);
          },
        },
      );
      const measured = parseLoudnessMeasurement(measurement);
      const normalize = measured
        ? `${target}:measured_I=${measured.integrated}:measured_TP=${measured.peak}:measured_LRA=${measured.range}:measured_thresh=${measured.threshold}:offset=${measured.offset}:linear=true`
        : "anull";
      await runProcess(
        binary,
        [
          "-y",
          ...input,
          "-af",
          [
            ...processing,
            normalize,
            `apad=whole_dur=${asset.duration}`,
            `atrim=duration=${asset.duration}`,
            "aresample=48000",
          ].join(","),
          "-ar",
          "48000",
          "-ac",
          "2",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-movflags",
          "+faststart",
          temporary,
        ],
        { timeout },
      );
      await fs.rename(temporary, file);
      return result;
    } finally {
      try {
        await fs.rm(temporary, { force: true });
      } finally {
        release();
      }
    }
  })();
  pending.set(requestKey, operation);
  void operation.finally(() => pending.delete(requestKey)).catch(() => {});
  return waitFor(operation, signal);
}
