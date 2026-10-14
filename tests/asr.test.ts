import { describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { speechEngineSchema, speechOptionsSchema } from "../shared/asr";
import { onnxWorkerArguments } from "../shared/onnx";
import { transcribeAsset } from "../electron/transcription";
import { runProcess } from "../electron/process";
vi.mock("../electron/process", () => ({
  findBinary: (name: string) => name,
  runProcess: vi.fn(),
}));

describe("字幕引擎与源时间映射", () => {
  it("SenseVoice 与 Paraformer 使用同一个 ONNX 环境，保留带空格的参数", () => {
    expect(speechEngineSchema.parse("sensevoice")).toBe("sensevoice");
    expect(speechEngineSchema.parse("paraformer")).toBe("paraformer");
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
  it("Paraformer 在提取音频前拒绝非中文模式", async () => {
    vi.mocked(runProcess).mockClear();
    await expect(
      transcribeAsset(
        { duration: 2 } as never,
        "paraformer",
        "yue",
        {},
        {
          userData: "unused",
          workers: "unused",
          temp: "unused",
          resources: "",
        },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("仅支持中文");
    expect(runProcess).not.toHaveBeenCalled();
  });
});
