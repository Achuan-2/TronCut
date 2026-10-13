import { describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import {
  speechEngineSchema,
  speechOptionsSchema,
  workerArguments,
} from "../shared/asr";
import { transcribeAsset } from "../electron/transcription";
import { runProcess } from "../electron/process";
vi.mock("../electron/process", () => ({
  findBinary: (name: string) => name,
  runProcess: vi.fn(),
}));

describe("字幕引擎与源时间映射", () => {
  it("SenseVoice 按需安装独立 extra，并保留带空格的参数", () => {
    expect(speechEngineSchema.parse("sensevoice")).toBe("sensevoice");
    const args = workerArguments(
      "sensevoice",
      "my workers",
      "transcribe.py",
      "中文 音频.wav",
      "字幕.json",
      "yue",
      "cpu",
    );
    expect(args.slice(0, 5)).toEqual([
      "run",
      "--project",
      "my workers",
      "--extra",
      "sensevoice",
    ]);
    expect(args).toContain("中文 音频.wav");
    expect(args).toContain("cpu");
    expect(
      workerArguments(
        "faster-whisper",
        "workers",
        "script",
        "input",
        "output",
        "zh",
        "auto",
      )[4],
    ).toBe("whisper");
  });
  it("拒绝无效设备和识别区间", () => {
    expect(() => speechOptionsSchema.parse({ device: "shell" })).toThrow();
    expect(() => speechOptionsSchema.parse({ sourceDuration: -1 })).toThrow();
    expect(speechOptionsSchema.parse({})).toEqual({
      device: "auto",
      sourceIn: 0,
    });
  });
  it("只提取指定源区间，转换为全局源时间并裁掉末尾越界", async () => {
    const temp = path.resolve("test-output/asr-contract");
    await fs.mkdir(temp, { recursive: true });
    const calls: string[][] = [];
    vi.mocked(runProcess).mockImplementation(async (_binary, args, options) => {
      calls.push(args);
      if (args.includes("--extra")) {
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
        workers: path.resolve("workers"),
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
        path.join(temp, "profile/workers/sensevoice.py"),
        "utf8",
      ),
    ).toContain("iic/SenseVoiceSmall");
  });
});
