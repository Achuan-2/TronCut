import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Asset } from "../shared/model";
import {
  type SpeechEngine,
  type SpeechOptions,
  speechOptionsSchema,
} from "../shared/asr";
import { onnxWorkerArguments } from "../shared/onnx";
import { findBinary, runProcess } from "./process";
import { onnxEnvironment, prepareOnnxWorker, runOnnxWorker } from "./onnx";

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
  paths: { userData: string; workers: string; temp: string; resources: string },
  signal: AbortSignal,
  progress: (percent: number, label: string) => void,
) {
  const options = speechOptionsSchema.parse(inputOptions);
  if (engine === "paraformer" && !["auto", "zh"].includes(language))
    throw new Error("Paraformer 仅支持中文，其他语言请选择 SenseVoiceSmall");
  const duration = options.sourceDuration ?? asset.duration - options.sourceIn;
  if (
    duration <= 0 ||
    options.sourceIn >= asset.duration ||
    options.sourceIn + duration > asset.duration + 0.1
  )
    throw new Error("识别范围超出了源素材时长");
  const audio = path.join(paths.temp, "audio.wav");
  const output = path.join(paths.temp, "captions.json");
  const request = path.join(paths.temp, "request.json");
  progress(0, "正在提取选中片段的音频");
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
  const workers = await prepareOnnxWorker(paths.workers, paths.userData);
  await fs.writeFile(
    request,
    JSON.stringify({ ...options, input: audio, engine, language }),
    "utf8",
  );
  progress(
    0,
    options.offline
      ? "正在加载本地 sherpa-onnx 识别环境与模型"
      : "正在准备 sherpa-onnx；优先复用本地模型，缺少时下载",
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
    throw new Error("转录没有产生有效字幕，可能是所选片段没有语音");
  return converted;
}
