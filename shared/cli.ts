import { z } from "zod";
import { speechEngineSchema } from "./asr";
import { projectSchema, styleSchema, transformSchema } from "./model";

const time = z.number().finite().nonnegative();
export const cutSchema = z
  .object({
    input: z.string().min(1),
    sourceIn: time.default(0),
    sourceOut: time.optional(),
    start: time.optional(),
    speed: z.number().finite().min(0.25).max(8).default(1),
    volume: z.number().finite().min(0).max(4).default(1),
  })
  .strict();
export const transcriptionSchema = z
  .object({
    engine: speechEngineSchema.default("qwen3-asr"),
    language: z.enum(["auto", "zh", "en", "ja", "ko", "yue"]).default("auto"),
    modelDir: z.string().default(""),
    offline: z.boolean().default(false),
    clipIds: z.array(z.string().min(1)).min(1).max(1000).optional(),
  })
  .strict();
export const narrationSchema = z
  .object({
    engine: z.enum(["kokoro-onnx", "vits-onnx"]).default("kokoro-onnx"),
    voice: z.string().default("10"),
    modelDir: z.string().default(""),
    offline: z.boolean().default(false),
    speed: z.number().finite().min(0.5).max(2).default(1),
    maxFitSpeed: z.number().finite().min(1).max(4).default(2),
    muteOriginal: z.boolean().default(true),
    captionChars: z.number().int().min(8).max(100).default(22),
    segments: z
      .array(
        z
          .object({
            start: time,
            end: time,
            text: z.string().trim().min(1).max(10000),
          })
          .strict(),
      )
      .min(1)
      .max(1000),
  })
  .strict()
  .superRefine((value, context) => {
    let previousEnd = 0;
    for (const [index, segment] of value.segments.entries()) {
      if (segment.end <= segment.start || segment.start < previousEnd)
        context.addIssue({
          code: "custom",
          path: ["segments", index],
          message: "文案段必须按时间排序、不重叠，结束时间大于开始时间",
        });
      previousEnd = segment.end;
    }
  });
export type NarrationScript = z.infer<typeof narrationSchema>;
export const editSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("remove"),
      clipIds: z.array(z.string()).min(1),
      ripple: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      type: z.literal("trim"),
      clipId: z.string(),
      sourceIn: time,
      sourceOut: time,
    })
    .strict(),
  z
    .object({
      type: z.literal("speed"),
      clipId: z.string(),
      speed: z.number().finite().min(0.25).max(8),
    })
    .strict(),
  z
    .object({ type: z.literal("move"), clipId: z.string(), start: time })
    .strict(),
  z
    .object({
      type: z.literal("volume"),
      clipId: z.string(),
      volume: z.number().finite().min(0).max(4),
    })
    .strict(),
  z
    .object({
      type: z.literal("text"),
      text: z.string().min(1).max(10000),
      start: time,
      end: time,
      transform: transformSchema.partial().optional(),
      style: styleSchema.partial().optional(),
    })
    .strict(),
]);
export type Edit = z.infer<typeof editSchema>;
export const cliPlanSchema = z
  .object({
    version: z.literal(1),
    name: z.string().min(1).max(200).default("CLI 视频"),
    project: z.string().optional(),
    cuts: z.array(cutSchema).min(1).max(1000).optional(),
    canvas: projectSchema.shape.canvas.partial().optional(),
    edits: z.array(editSchema).max(10000).default([]),
    transcribe: z.union([z.literal(false), transcriptionSchema]).optional(),
    narration: narrationSchema.optional(),
    music: z
      .array(
        z
          .object({
            input: z.string().min(1),
            start: time.default(0),
            sourceIn: time.default(0),
            duration: z.number().finite().positive().optional(),
            volume: z.number().finite().min(0).max(4).default(0.5),
          })
          .strict(),
      )
      .default([]),
    captions: z
      .object({
        y: z.number().min(0).max(1).default(0.85),
        fontSize: z.number().min(8).max(300).optional(),
      })
      .strict()
      .default({}),
    output: z
      .object({
        project: z.string().min(1),
        video: z.string().optional(),
        srt: z.string().optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Boolean(value.project) === Boolean(value.cuts))
      context.addIssue({
        code: "custom",
        message: "必须选择 project 或 cuts 之一作为输入",
      });
  });
export type CliPlan = z.infer<typeof cliPlanSchema>;

export const cliHelp = {
  protocol: "troncut-cli-v1",
  commands: {
    inspect: "--input 媒体文件 或 --project 工程；返回素材、片段、时长等 JSON",
    frames:
      "--input 媒体 或 --project 工程 --output 文件夹 [--interval 2 --max-frames 40]；抽帧并生成 Codex 文案说明",
    build: "--plan 剪辑计划.json；创建可编辑工程，不执行语音或导出",
    edit: "--project 工程 --edits 编辑操作.json --output 新工程",
    transcribe:
      "--project 工程 --output 新工程 [--engine qwen3-asr --language auto --model-dir 路径 --offline --srt 字幕.srt]",
    narrate:
      "--project 工程 --script 分段文案.json --output 新工程 [--srt 字幕.srt]",
    export: "--project 工程 --output 视频.mp4 [--software]",
    run: "--plan 计划.json；剪辑→转录或文案配音→字幕→保存工程→导出；无语音且未提供文案时返回 needs_script 与抽帧",
    models: "--engine qwen3-asr|sensevoice|kokoro-onnx|vits-onnx；下载模型",
  },
  common:
    "--overwrite 允许替换已有输出；--result 结果.json 保存机器可读结果；--cancel-file 文件：创建该文件取消任务；进度为 stderr JSONL，最终结果为 stdout JSON",
  planExample: {
    version: 1,
    cuts: [{ input: "input.mp4", sourceIn: 0, sourceOut: 10 }],
    narration: {
      segments: [{ start: 0, end: 10, text: "根据实际画面写出的解说。" }],
    },
    output: {
      project: "output/project.troncut",
      video: "output/video.mp4",
      srt: "output/captions.srt",
    },
  },
  editTypes: ["remove", "trim", "speed", "move", "volume", "text"],
  scriptGeneration:
    "由调用者读取 frames.json 中的画面，生成 narration.segments，再调用 narrate 或 run；CLI 不虚构未观察到的画面内容。",
};
