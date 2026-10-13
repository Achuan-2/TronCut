import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Asset } from "../shared/model";
import {
  type SpeechEngine,
  type SpeechOptions,
  speechOptionsSchema,
  workerArguments,
} from "../shared/asr";
import { parseSrt } from "../shared/subtitles";
import { findBinary, runProcess } from "./process";

const cueSchema = z.object({
  start: z.number().finite().nonnegative(),
  end: z.number().finite().positive(),
  text: z.string(),
});
const progressSchema = z.object({
  percent: z.number().finite().min(0).max(100),
  label: z.string().max(500),
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
  if (language === "yue" && engine !== "sensevoice")
    throw new Error("粤语选项请使用 SenseVoiceSmall 引擎");
  const duration = options.sourceDuration ?? asset.duration - options.sourceIn;
  if (
    options.sourceIn >= asset.duration ||
    options.sourceIn + duration > asset.duration + 0.1
  )
    throw new Error("识别范围超出了源素材时长");
  const audio = path.join(paths.temp, "audio.wav"),
    output = path.join(paths.temp, "captions.json");
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
      audio,
    ],
    { signal },
  );
  let cues;
  if (engine === "whisper-cpp") {
    const srt = path.join(paths.temp, "captions.srt");
    await runProcess(
      findBinary("videocaptioner", paths.resources),
      [
        "transcribe",
        audio,
        "--asr",
        engine,
        "--language",
        language,
        "--word-timestamps",
        "--format",
        "srt",
        "-o",
        srt,
      ],
      { signal },
    );
    cues = parseSrt(await fs.readFile(srt, "utf8"));
  } else {
    const workers = path.join(paths.userData, "workers");
    await fs.mkdir(workers, { recursive: true });
    for (const name of [
      "pyproject.toml",
      "transcribe.py",
      "sensevoice.py",
      "caption_utils.py",
    ])
      await fs.copyFile(
        path.join(paths.workers, name),
        path.join(workers, name),
      );
    const lock = path.join(paths.workers, "uv.lock");
    if (
      await fs.access(lock).then(
        () => true,
        () => false,
      )
    )
      await fs.copyFile(lock, path.join(workers, "uv.lock"));
    progress(
      0,
      `${engine === "sensevoice" ? "SenseVoiceSmall" : "Faster Whisper"}：首次运行会下载依赖与模型`,
    );
    await runProcess(
      findBinary("uv", paths.resources),
      workerArguments(
        engine,
        workers,
        path.join(workers, "transcribe.py"),
        audio,
        output,
        language,
        options.device,
      ),
      {
        signal,
        env: {
          ...process.env,
          PYTHONUTF8: "1",
          UV_CACHE_DIR: path.join(paths.userData, "uv-cache"),
          UV_PYTHON_INSTALL_DIR: path.join(paths.userData, "python"),
          MODELSCOPE_CACHE: path.join(paths.userData, "models", "modelscope"),
          HF_HOME: path.join(paths.userData, "models", "huggingface"),
        },
        onLine: (line) => {
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
    cues = z
      .array(cueSchema)
      .parse(JSON.parse(await fs.readFile(output, "utf8")));
  }
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
