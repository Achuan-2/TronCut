import { describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { speechEngineSchema, speechOptionsSchema } from "../shared/asr";
import { onnxWorkerArguments } from "../shared/onnx";
import { transcribeAsset, transcribeProject } from "../electron/transcription";
import { createProject, newText } from "../shared/model";
import { runProcess } from "../electron/process";
vi.mock("../electron/process", () => ({
  findBinary: (name: string) => name,
  runProcess: vi.fn(),
}));

describe("字幕引擎与源时间映射", () => {
  it("Qwen3-ASR 与 SenseVoice 使用同一个 ONNX 环境，已移除 Paraformer", () => {
    expect(speechEngineSchema.parse("qwen3-asr")).toBe("qwen3-asr");
    expect(speechEngineSchema.parse("sensevoice")).toBe("sensevoice");
    expect(speechEngineSchema.safeParse("paraformer").success).toBe(false);
    expect(speechEngineSchema.safeParse("faster-whisper").success).toBe(false);
    const args = onnxWorkerArguments(
      "my workers",
      "transcribe.py",
      "中文 音频.json",
      "字幕.json",
      true,
    );
    expect(args).toContain("中文 音频.json");
    expect(args).toContain("--offline");
    expect(args).toContain("--frozen");
    expect(args).not.toContain("--extra");
  });
  it("拒绝无效设备和识别区间", () => {
    expect(() => speechOptionsSchema.parse({ device: "shell" })).toThrow();
    expect(() => speechOptionsSchema.parse({ sourceDuration: -1 })).toThrow();
    expect(speechOptionsSchema.parse({})).toEqual({
      device: "auto",
      sourceIn: 0,
      modelDir: "",
      offline: false,
    });
  });
  it("只提取指定源区间，转换为全局源时间并裁掉末尾越界", async () => {
    const temp = path.resolve("test-output/asr-contract");
    await fs.mkdir(temp, { recursive: true });
    const calls: string[][] = [];
    vi.mocked(runProcess).mockImplementation(async (_binary, args, options) => {
      calls.push(args);
      if (args.includes("--request")) {
        const request = JSON.parse(
          await fs.readFile(args[args.indexOf("--request") + 1], "utf8"),
        );
        expect(request).toMatchObject({
          engine: "sensevoice",
          language: "zh",
          device: "cpu",
        });
        expect(options?.env?.TRONCUT_ONNX_MODELS).toBe(
          path.join(temp, "profile/models/onnx"),
        );
        const output = args[args.indexOf("--output") + 1];
        await fs.writeFile(
          output,
          JSON.stringify([{ start: 0.2, end: 2.5, text: "中文" }]),
        );
        options?.onLine?.(
          'FRAMECRAFT_PROGRESS {"percent":98,"label":"SenseVoice 完成"}',
        );
      }
      return "";
    });
    const events: number[] = [];
    const asset = {
      id: "a",
      path: "source.mp4",
      name: "source.mp4",
      kind: "video" as const,
      duration: 100,
      width: 320,
      height: 180,
      hasAudio: true,
    };
    const result = await transcribeAsset(
      asset,
      "sensevoice",
      "zh",
      { sourceIn: 20, sourceDuration: 2, device: "cpu" },
      {
        temp,
        workers: path.resolve("workers/onnx"),
        userData: path.join(temp, "profile"),
        resources: "",
      },
      new AbortController().signal,
      (p) => events.push(p),
    );
    expect(calls[0].slice(0, 7)).toEqual([
      "-y",
      "-ss",
      "20",
      "-t",
      "2",
      "-i",
      "source.mp4",
    ]);
    expect(result).toEqual([{ start: 20.2, end: 22, text: "中文" }]);
    expect(events).toContain(98);
    expect(
      await fs.readFile(
        path.join(temp, "profile/workers/onnx/transcribe.py"),
        "utf8",
      ),
    ).toContain("from_sense_voice");
  });
  it("全局识别混音一次并返回工程时间，不使用传入的源区间限制", async () => {
    const temp = path.resolve(`test-output/project-asr-contract-${Date.now()}`);
    await fs.mkdir(temp, { recursive: true });
    const project = createProject();
    project.assets = [
      {
        id: "sound",
        path: "source.wav",
        name: "音频",
        kind: "audio",
        duration: 20,
        width: 0,
        height: 0,
        hasAudio: true,
      },
    ];
    project.clips = [
      {
        ...newText("video", 2),
        kind: "audio",
        assetId: "sound",
        sourceIn: 4,
        duration: 2,
        speed: 2,
      },
      { ...newText("audio", 8), kind: "audio", assetId: "sound", duration: 2 },
    ];
    const requests: unknown[] = [];
    vi.mocked(runProcess).mockImplementation(async (_binary, args) => {
      if (args.includes("--request")) {
        requests.push(
          JSON.parse(
            await fs.readFile(args[args.indexOf("--request") + 1], "utf8"),
          ),
        );
        await fs.writeFile(
          args.at(-1)!,
          JSON.stringify([
            { start: 2.2, end: 3.8, text: "前一句" },
            { start: 8.1, end: 10.5, text: "后一句" },
          ]),
        );
      }
      return args.includes("-version") ? "ffmpeg version 8.0" : "";
    });
    const result = await transcribeProject(
      project,
      "qwen3-asr",
      "auto",
      { sourceIn: 4, sourceDuration: 1 },
      {
        temp,
        userData: path.join(temp, "profile"),
        workers: path.resolve("workers/onnx"),
        resources: "",
      },
      new AbortController().signal,
      () => {},
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      input: path.join(temp, "timeline.wav"),
      engine: "qwen3-asr",
      sourceIn: 0,
    });
    expect(result).toEqual([
      { start: 2.2, end: 3.8, text: "前一句" },
      { start: 8.1, end: 10, text: "后一句" },
    ]);
  });
});
