import { z } from "zod";
import { onnxWorkerArguments } from "./onnx";

export const onnxTtsModels = {
  "kokoro-onnx": {
    name: "Kokoro v1.1 · 中英文 ONNX",
    repo: "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_1.tar.bz2",
    extra: "onnx",
    voices: Array.from({ length: 103 }, (_, sid) => ({
      id: String(sid),
      name:
        sid < 3
          ? ["Maple · 美式女声", "Sol · 美式女声", "Vale · 英式女声"][sid]
          : sid < 58
            ? `中文女声 ${String(sid - 2).padStart(2, "0")}`
            : `中文男声 ${String(sid - 57).padStart(2, "0")}`,
    })),
  },
  "vits-onnx": {
    name: "VITS AIShell3 · 中文 ONNX",
    repo: "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-icefall-zh-aishell3.tar.bz2",
    extra: "onnx",
    voices: Array.from({ length: 174 }, (_, sid) => ({
      id: String(sid),
      name: `中文说话人 ${String(sid + 1).padStart(3, "0")}`,
    })),
  },
} as const;
export type OnnxTtsEngine = keyof typeof onnxTtsModels;

export interface WindowsSpeechVoice {
  id: string;
  name: string;
  language: string;
  gender: string;
}
export const availableTtsModels = {
  "windows-sapi": {
    name: "Windows 系统语音 · 本机音色",
    repo: "https://learn.microsoft.com/dotnet/api/system.speech.synthesis.speechsynthesizer",
    voices: [{ id: "auto", name: "自动 · 优先微软云希" }],
  },
  ...onnxTtsModels,
} as const;
export type AvailableTtsEngine = keyof typeof availableTtsModels;

export const ttsModels = {
  ...availableTtsModels,
  kokoro: {
    name: "Kokoro 中文版 · 轻量",
    repo: "hexgrad/Kokoro-82M-v1.1-zh",
    extra: "kokoro",
    voices: [
      { id: "zf_001", name: "中文女声 001" },
      { id: "zf_002", name: "中文女声 002" },
      { id: "zm_010", name: "中文男声 010" },
    ],
  },
  "qwen-small": {
    name: "Qwen3-TTS 0.6B · 标准音色",
    repo: "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
    extra: "qwen",
    voices: [
      { id: "Vivian", name: "Vivian · 明亮女声" },
      { id: "Serena", name: "Serena · 温柔女声" },
      { id: "Uncle_Fu", name: "Uncle Fu · 低沉男声" },
      { id: "Dylan", name: "Dylan · 北京男声" },
      { id: "Eric", name: "Eric · 四川男声" },
      { id: "Ryan", name: "Ryan · 英语男声" },
      { id: "Aiden", name: "Aiden · 美式男声" },
    ],
  },
  "qwen-quality": {
    name: "Qwen3-TTS 1.7B · 语气控制",
    repo: "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
    extra: "qwen",
    voices: [
      { id: "Vivian", name: "Vivian · 明亮女声" },
      { id: "Serena", name: "Serena · 温柔女声" },
      { id: "Uncle_Fu", name: "Uncle Fu · 低沉男声" },
      { id: "Dylan", name: "Dylan · 北京男声" },
      { id: "Eric", name: "Eric · 四川男声" },
      { id: "Ryan", name: "Ryan · 英语男声" },
      { id: "Aiden", name: "Aiden · 美式男声" },
    ],
  },
  indextts: {
    name: "IndexTTS 2.5 · 参考音频配音",
    repo: "IndexTeam/IndexTTS-2.5",
    extra: "indextts",
    voices: [{ id: "reference", name: "参考音频音色" }],
  },
} as const;
export type TtsEngine = keyof typeof ttsModels;
export const ttsOptionsSchema = z
  .object({
    text: z.string().trim().min(1, "请输入配音文字").max(10000),
    // Legacy engines remain readable in saved projects.
    engine: z.enum([
      "windows-sapi",
      "kokoro-onnx",
      "vits-onnx",
      "kokoro",
      "qwen-small",
      "qwen-quality",
      "indextts",
    ]),
    voice: z.string().min(1).max(1024),
    language: z.enum(["zh", "en"]).default("zh"),
    device: z.enum(["auto", "cpu", "cuda", "mps"]).default("auto"),
    speed: z.number().finite().min(0.5).max(2).default(1),
    instruction: z.string().trim().max(500).default(""),
    offline: z.boolean().default(false),
    modelDir: z.string().trim().max(4096).optional(),
    captionChars: z.number().int().min(8).max(100).optional(),
    referenceAssetId: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,128}$/)
      .optional(),
  })
  .superRefine((options, context) => {
    if (
      options.engine in onnxTtsModels &&
      !["cpu", "auto"].includes(options.device)
    )
      context.addIssue({
        code: "custom",
        path: ["device"],
        message: "当前 sherpa-onnx 运行环境使用 CPU，请选择 CPU 或自动",
      });
    if (options.engine === "vits-onnx" && options.language !== "zh")
      context.addIssue({
        code: "custom",
        path: ["language"],
        message: "VITS AIShell3 仅支持中文，英语请选择 Kokoro",
      });
    if (options.engine === "indextts" && !options.referenceAssetId)
      context.addIssue({
        code: "custom",
        path: ["referenceAssetId"],
        message: "IndexTTS 需要选择参考音频",
      });
    if (options.engine === "indextts" && options.device === "mps")
      context.addIssue({
        code: "custom",
        path: ["device"],
        message: "IndexTTS 的 MPS 尚未验证，请选择 CPU 或 NVIDIA CUDA",
      });
    if (
      options.engine === "windows-sapi" &&
      !["cpu", "auto"].includes(options.device)
    )
      context.addIssue({
        code: "custom",
        path: ["device"],
        message: "Windows 系统语音无需选择 GPU",
      });
    if (
      options.engine !== "windows-sapi" &&
      !ttsModels[options.engine].voices.some((v) => v.id === options.voice)
    )
      context.addIssue({
        code: "custom",
        path: ["voice"],
        message: "请选择该模型支持的音色",
      });
    if (options.engine === "kokoro" && options.language !== "zh")
      context.addIssue({
        code: "custom",
        path: ["language"],
        message: "Kokoro 中文版请使用中文模式；英语配音请选择 Qwen3-TTS",
      });
    if (options.engine !== "qwen-quality" && options.instruction)
      context.addIssue({
        code: "custom",
        path: ["instruction"],
        message: "语气指令请使用 Qwen3-TTS 1.7B",
      });
  });
export type TtsOptions = z.input<typeof ttsOptionsSchema>;

export function ttsWorkerArguments(
  options: TtsOptions,
  workers: string,
  request: string,
  output: string,
): string[] {
  if (options.engine in onnxTtsModels)
    return onnxWorkerArguments(
      workers,
      "synthesize.py",
      request,
      output,
      options.offline,
    );
  throw new Error("配音已改用 ONNX，请选择 Kokoro 或 VITS");
}
