import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  ttsModels,
  ttsOptionsSchema,
  ttsWorkerArguments,
  type TtsOptions,
} from "../shared/tts";
import { findBinary, runProcess } from "./process";
import { probeMedia } from "./media";

const progressSchema = z.object({
  percent: z.number().finite().min(0).max(100),
  label: z.string().max(500),
});
const runtimeSchema = z.object({
  model: z.string().max(200),
  device: z.string().max(50),
  precision: z.string().max(50).optional(),
  sampleRate: z.number().int().positive(),
  duration: z.number().finite().positive(),
  loadSeconds: z.number().finite().nonnegative(),
  generationSeconds: z.number().finite().nonnegative(),
});

/** Keep generated narration in user data until project save collects it into media/. */
export async function synthesizeSpeech(
  input: TtsOptions,
  paths: {
    userData: string;
    workers: string;
    resources: string;
    referenceAudio?: string;
  },
  signal: AbortSignal,
  progress: (percent: number, label: string) => void,
) {
  const options = ttsOptionsSchema.parse(input);
  const indexTts = options.engine === "indextts";
  if (indexTts && !paths.referenceAudio)
    throw new Error("IndexTTS 需要已导入的参考音频");
  if (signal.aborted) throw new Error("配音已取消");
  progress(0, "正在检查配音运行环境");
  // Detect missing engines before downloading dependencies or model weights.
  await Promise.all(
    ["uv", "ffmpeg", "ffprobe"].map((name) =>
      runProcess(
        findBinary(name, paths.resources),
        [name === "uv" ? "--version" : "-version"],
        { signal, timeout: 10000 },
      ),
    ),
  );
  // Detect NVIDIA hardware before preparing the large CUDA runtime. Auto mode
  // may fall back to CPU; an explicit CUDA request reports the problem directly.
  let device = options.device;
  if (indexTts && (device === "cuda" || device === "auto")) {
    try {
      const gpu = await runProcess(
        "nvidia-smi",
        ["--query-gpu=name", "--format=csv,noheader"],
        { signal, timeout: 10000 },
      );
      if (!gpu.trim()) throw new Error("没有检测到 NVIDIA 显卡");
      device = "cuda";
    } catch (error) {
      if (signal.aborted) throw new Error("配音已取消");
      if (options.device === "cuda")
        throw new Error("未检测到可用的 NVIDIA 驱动，请安装驱动或选择 CPU");
      device = "cpu";
      progress(0, "未检测到 NVIDIA 显卡，IndexTTS 将使用 CPU");
    }
  }
  const workers = path.join(
    paths.userData,
    "workers",
    indexTts ? "indextts" : "tts",
  );
  await fs.mkdir(workers, { recursive: true });
  for (const file of [
    "pyproject.toml",
    "uv.lock",
    "synthesize.py",
    indexTts ? "models.py" : "tts_utils.py",
  ])
    await fs.copyFile(path.join(paths.workers, file), path.join(workers, file));
  const root = path.join(paths.userData, "narration");
  await fs.mkdir(root, { recursive: true });
  const folder = await fs.mkdtemp(path.join(root, "speech-"));
  const request = path.join(folder, "request.json");
  const raw = path.join(folder, "raw.wav");
  const output = path.join(folder, "narration.wav");
  const reference = path.join(folder, "reference.wav");
  try {
    if (indexTts) {
      progress(0, "正在处理参考音频（使用前 15 秒）");
      await runProcess(
        findBinary("ffmpeg", paths.resources),
        [
          "-y",
          "-i",
          paths.referenceAudio!,
          "-t",
          "15",
          "-vn",
          "-ar",
          "24000",
          "-ac",
          "1",
          "-c:a",
          "pcm_s16le",
          reference,
        ],
        { signal },
      );
    }
    await fs.writeFile(
      request,
      JSON.stringify({
        ...options,
        device,
        ...(indexTts ? { referenceAudio: reference } : {}),
      }),
      "utf8",
    );
    progress(
      0,
      options.offline
        ? "正在加载本地配音模型"
        : "首次配音会下载依赖与模型，之后可离线使用",
    );
    await runProcess(
      findBinary("uv", paths.resources),
      ttsWorkerArguments({ ...options, device }, workers, request, raw),
      {
        signal,
        cwd: workers,
        env: {
          ...process.env,
          PYTHONUTF8: "1",
          UV_CACHE_DIR: path.join(paths.userData, "uv-cache"),
          UV_PYTHON_INSTALL_DIR: path.join(paths.userData, "python"),
          HF_HOME: path.join(paths.userData, "models", "huggingface"),
          HF_HUB_OFFLINE: options.offline ? "1" : "0",
          HF_DATASETS_OFFLINE: options.offline ? "1" : "0",
          HF_HUB_DISABLE_TELEMETRY: "1",
          PYTORCH_ENABLE_MPS_FALLBACK: "1",
          TRONCUT_INDEXTTS_MODELS: path.join(
            paths.userData,
            "models",
            "indextts2_5",
          ),
          NLTK_DATA: path.join(paths.userData, "models", "nltk"),
          PATH: [
            path.dirname(findBinary("ffmpeg", paths.resources)),
            process.env.PATH ?? "",
          ].join(path.delimiter),
          UV_PROJECT_ENVIRONMENT: path.join(
            workers,
            `.venv-${ttsModels[options.engine].extra}-${device === "cuda" ? "cuda" : "cpu"}`,
          ),
        },
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
    );
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
      .then((data) => {
        const parsed = runtimeSchema.safeParse(JSON.parse(data));
        return parsed.success ? parsed.data : undefined;
      })
      .catch(() => undefined);
    const metadata = {
      ...options,
      model: ttsModels[options.engine].repo,
      duration: asset.duration,
      runtime,
    };
    await fs.writeFile(
      path.join(folder, "narration.json"),
      JSON.stringify(metadata, null, 2),
      "utf8",
    );
    await Promise.all(
      [request, raw, `${raw}.json`, reference].map((file) =>
        fs.rm(file, { force: true }),
      ),
    );
    if (signal.aborted) throw new Error("配音已取消");
    progress(100, "配音生成完成");
    return asset;
  } catch (error) {
    await fs.rm(folder, { recursive: true, force: true });
    throw error;
  }
}
