import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Asset, Project } from "../shared/model";
import {
  type SpeechEngine,
  type SpeechOptions,
  speechOptionsSchema,
} from "../shared/asr";
import { onnxWorkerArguments } from "../shared/onnx";
import { findBinary, runProcess } from "./process";
import { onnxEnvironment, prepareOnnxWorker, runOnnxWorker } from "./onnx";
import { renderTimelineAudio } from "./timeline-audio";

type TranscriptionPaths = {
  userData: string;
  workers: string;
  temp: string;
  resources: string;
};

export async function transcribeProject(
  project: Project,
  engine: SpeechEngine,
  language: string,
  inputOptions: SpeechOptions,
  paths: TranscriptionPaths,
  signal: AbortSignal,
  progress: (percent: number, label: string) => void,
) {
  const options = speechOptionsSchema.parse(inputOptions);
  const audio = path.join(paths.temp, "timeline.wav");
  progress(0, "正在合成整个时间线的声音");
  const duration = await renderTimelineAudio(
    project,
    audio,
    paths.temp,
    signal,
    paths.resources,
  );
  return recognizeAudio(
    audio,
    duration,
    engine,
    language,
    { ...options, sourceIn: 0, sourceDuration: duration },
    paths,
    signal,
    progress,
  );
}

const cueSchema = z.object({
  start: z.number().finite().nonnegative(),
  end: z.number().finite().positive(),
  text: z.string(),
});
const progressSchema = z.object({
  percent: z.number().finite().min(0).max(100),
  label: z.string().max(5000),
});

export async function transcribeAsset(
  asset: Asset,
  engine: SpeechEngine,
  language: string,
  inputOptions: SpeechOptions,
  paths: TranscriptionPaths,
  signal: AbortSignal,
  progress: (percent: number, label: string) => void,
) {
  const options = speechOptionsSchema.parse(inputOptions);
  const duration = options.sourceDuration ?? asset.duration - options.sourceIn;
  if (
    duration <= 0 ||
    options.sourceIn >= asset.duration ||
    options.sourceIn + duration > asset.duration + 0.1
  )
    throw new Error("识别范围超出了源素材时长");
  const audio = path.join(paths.temp, "audio.wav");
  progress(0, "正在提取音频");
  await runProcess(
    findBinary("ffmpeg", paths.resources),
    [
      "-y",
      "-ss",
      String(options.sourceIn),
      "-t",
      String(duration),
      "-i",
      asset.path,
      "-vn",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      audio,
    ],
    { signal },
  );
  return recognizeAudio(
    audio,
    duration,
    engine,
    language,
    options,
    paths,
    signal,
    progress,
  );
}

async function recognizeAudio(
  audio: string,
  duration: number,
  engine: SpeechEngine,
  language: string,
  options: ReturnType<typeof speechOptionsSchema.parse>,
  paths: TranscriptionPaths,
  signal: AbortSignal,
  progress: (percent: number, label: string) => void,
) {
  const output = path.join(paths.temp, "captions.json");
  const request = path.join(paths.temp, "request.json");
  const workers = await prepareOnnxWorker(paths.workers, paths.userData);
  await fs.writeFile(
    request,
    JSON.stringify({ ...options, input: audio, engine, language }),
    "utf8",
  );
  progress(
    0,
    options.offline
      ? `正在加载本地 ${engine} 识别环境与模型`
      : `正在准备 ${engine}；优先复用本地模型，缺少时下载`,
  );
  await runOnnxWorker(
    findBinary("uv", paths.resources),
    onnxWorkerArguments(
      workers,
      "transcribe.py",
      request,
      output,
      options.offline,
    ),
    {
      signal,
      cwd: workers,
      env: onnxEnvironment(paths.userData, workers),
      onLine(line) {
        const prefix = "FRAMECRAFT_PROGRESS ";
        if (!line.startsWith(prefix)) return;
        try {
          const event = progressSchema.parse(
            JSON.parse(line.slice(prefix.length)),
          );
          progress(event.percent, event.label);
        } catch {
          /* Ordinary model logs are not progress events. */
        }
      },
    },
  );
  if (signal.aborted) throw new Error("字幕生成已取消");
  const cues = z
    .array(cueSchema)
    .parse(JSON.parse(await fs.readFile(output, "utf8")));
  const converted = cues
    .filter((c) => c.text.trim() && c.end > c.start && c.start < duration)
    .map((c) => ({
      ...c,
      start: c.start + options.sourceIn,
      end: Math.min(c.end, duration) + options.sourceIn,
    }));
  if (!converted.length)
    throw new Error("转录没有产生有效字幕，可能是音频中没有语音");
  return converted;
}
