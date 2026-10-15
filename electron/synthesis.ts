import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  onnxTtsModels,
  ttsModels,
  ttsOptionsSchema,
  ttsWorkerArguments,
  type TtsOptions,
} from "../shared/tts";
import { findBinary, runProcess } from "./process";
import { probeMedia } from "./media";
import { onnxEnvironment, prepareOnnxWorker, runOnnxWorker } from "./onnx";
import { synthesizeWindowsSpeech } from "./windows-speech";

const progressSchema = z.object({
  percent: z.number().finite().min(0).max(100),
  label: z.string().max(5000),
});
const runtimeSchema = z.object({
  model: z.string().max(200),
  device: z.string().max(50),
  precision: z.string().max(50).optional(),
  sampleRate: z.number().int().positive(),
  duration: z.number().finite().positive(),
  loadSeconds: z.number().finite().nonnegative(),
  modelCached: z.boolean().optional(),
  generationSeconds: z.number().finite().nonnegative(),
  modelDirectory: z.string().max(4096).optional(),
  voiceId: z.string().max(1024).optional(),
  voiceName: z.string().max(500).optional(),
  segments: z
    .array(
      z.object({
        start: z.number().finite().nonnegative(),
        end: z.number().finite().positive(),
        text: z.string(),
      }),
    )
    .optional(),
});

/** Keep generated narration in user data until project save collects it into media/. */
export async function synthesizeSpeech(
  input: TtsOptions,
  paths: { userData: string; workers: string; resources: string },
  signal: AbortSignal,
  progress: (percent: number, label: string) => void,
) {
  const options = ttsOptionsSchema.parse(input);
  const windows = options.engine === "windows-sapi";
  if (!windows && !(options.engine in onnxTtsModels))
    throw new Error(
      "配音已改用 ONNX，请重新选择 Kokoro 或 VITS；已有配音仍可播放",
    );
  if (signal.aborted) throw new Error("配音已取消");
  progress(
    0,
    windows ? "正在准备 Windows 系统语音" : "正在检查 sherpa-onnx 配音运行环境",
  );
  await Promise.all(
    (windows ? ["ffmpeg", "ffprobe"] : ["uv", "ffmpeg", "ffprobe"]).map(
      (name) =>
        runProcess(
          findBinary(name, paths.resources),
          [name === "uv" ? "--version" : "-version"],
          { signal, timeout: 10000 },
        ),
    ),
  );
  const workers = windows
    ? paths.workers
    : await prepareOnnxWorker(paths.workers, paths.userData);
  const root = path.join(paths.userData, "narration");
  await fs.mkdir(root, { recursive: true });
  const folder = await fs.mkdtemp(path.join(root, "speech-"));
  const request = path.join(folder, "request.json");
  const raw = path.join(folder, "raw.wav");
  const output = path.join(folder, "narration.wav");
  try {
    if (windows) {
      await synthesizeWindowsSpeech(
        options,
        workers,
        request,
        raw,
        signal,
        progress,
      );
    } else {
      await fs.writeFile(
        request,
        JSON.stringify({ ...options, device: "cpu" }),
        "utf8",
      );
      progress(
        0,
        options.offline
          ? "正在加载本地 ONNX 配音模型"
          : "正在准备 sherpa-onnx；优先复用本地模型，缺少时下载",
      );
      await runOnnxWorker(
        findBinary("uv", paths.resources),
        ttsWorkerArguments(options, workers, request, raw),
        {
          signal,
          cwd: workers,
          env: onnxEnvironment(paths.userData, workers),
          onLine(line) {
            const prefix = "TRONCUT_PROGRESS ";
            if (!line.startsWith(prefix)) return;
            try {
              const event = progressSchema.parse(
                JSON.parse(line.slice(prefix.length)),
              );
              progress(event.percent, event.label);
            } catch {
              /* Ignore ordinary model output. */
            }
          },
        },
        true,
      );
    }
    if (signal.aborted) throw new Error("配音已取消");
    progress(95, "正在保存配音音频");
    await runProcess(
      findBinary("ffmpeg", paths.resources),
      [
        "-y",
        "-i",
        raw,
        "-vn",
        "-af",
        `atempo=${options.speed}`,
        "-ar",
        "48000",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        output,
      ],
      { signal },
    );
    const asset = await probeMedia(output, paths.resources);
    if (signal.aborted) throw new Error("配音已取消");
    if (asset.kind !== "audio" || !asset.hasAudio || asset.duration <= 0)
      throw new Error("模型没有生成有效的配音音频");
    asset.name = `配音 · ${options.text.slice(0, 24).replace(/\s+/g, " ")}.wav`;
    asset.narration = options;
    const runtime = await fs
      .readFile(`${raw}.json`, "utf8")
      .then((data) => runtimeSchema.parse(JSON.parse(data)));
    await fs.writeFile(
      path.join(folder, "narration.json"),
      JSON.stringify(
        {
          ...options,
          model: ttsModels[options.engine].repo,
          duration: asset.duration,
          runtime,
        },
        null,
        2,
      ),
      "utf8",
    );
    await Promise.all(
      [request, raw, `${raw}.json`].map((file) => fs.rm(file, { force: true })),
    );
    if (signal.aborted) throw new Error("配音已取消");
    progress(100, "配音生成完成");
    return asset;
  } catch (error) {
    await fs.rm(folder, { recursive: true, force: true });
    throw error;
  }
}
