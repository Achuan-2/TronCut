import { z } from "zod";

export const ttsModels = {
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
    engine: z.enum(["kokoro", "qwen-small", "qwen-quality", "indextts"]),
    voice: z.string().max(50),
    language: z.enum(["zh", "en"]).default("zh"),
    device: z.enum(["auto", "cpu", "cuda", "mps"]).default("auto"),
    speed: z.number().finite().min(0.5).max(2).default(1),
    instruction: z.string().trim().max(500).default(""),
    offline: z.boolean().default(false),
    referenceAssetId: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,128}$/)
      .optional(),
  })
  .superRefine((options, context) => {
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
    if (!ttsModels[options.engine].voices.some((v) => v.id === options.voice))
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
  return [
    "run",
    "--project",
    workers,
    "--python",
    options.engine === "indextts" ? "3.11" : "3.12",
    "--frozen",
    ...(options.engine === "indextts"
      ? []
      : ["--extra", ttsModels[options.engine].extra]),
    "--extra",
    options.device === "cuda" ? "cuda" : "cpu",
    ...(options.offline ? ["--offline"] : []),
    "python",
    `${workers}/synthesize.py`,
    "--request",
    request,
    "--output",
    output,
  ];
}
