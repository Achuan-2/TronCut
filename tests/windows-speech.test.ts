import fs from "node:fs/promises";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { ttsOptionsSchema } from "../shared/tts";
import { narrationSchema } from "../shared/cli";
import {
  windowsSpeechVoices,
  synthesizeWindowsSpeech,
} from "../electron/windows-speech";
import { runProcess } from "../electron/process";

vi.mock("../electron/process", () => ({ runProcess: vi.fn() }));

it("Windows 系统音色 ID 可以随项目保留，CLI 未指定音色时自动优先云希", () => {
  expect(
    ttsOptionsSchema.parse({
      text: "中文男声",
      engine: "windows-sapi",
      voice: "Local-MicrosoftWindows.Voice.zh-CN.Yunxi.1",
      offline: true,
    }).engine,
  ).toBe("windows-sapi");
  expect(
    ttsOptionsSchema.safeParse({
      text: "语音",
      engine: "windows-sapi",
      voice: "auto",
      device: "cuda",
    }).success,
  ).toBe(false);
  expect(
    narrationSchema.parse({
      engine: "windows-sapi",
      segments: [{ start: 0, end: 5, text: "测试" }],
    }).voice,
  ).toBe("auto");
  expect(
    narrationSchema.parse({ segments: [{ start: 0, end: 5, text: "测试" }] })
      .voice,
  ).toBe("10");
});

it.runIf(process.platform === "win32")(
  "音色枚举只使用随附脚本，通过 JSON 返回，不启动模型环境",
  async () => {
    const voices = [
      {
        id: "voice-id",
        name: "Microsoft Yunxi",
        language: "zh-CN",
        gender: "Male",
      },
    ];
    vi.mocked(runProcess).mockResolvedValueOnce(JSON.stringify(voices));
    expect(await windowsSpeechVoices(path.resolve("workers/onnx"))).toEqual(
      voices,
    );
    const [binary, args, options] = vi.mocked(runProcess).mock.calls.at(-1)!;
    expect(binary).toMatch(/WindowsPowerShell/);
    expect(args).toContain("-NonInteractive");
    expect(args).toContain(
      path.resolve("workers/windows-speech/synthesize.ps1"),
    );
    expect(args).not.toContain("-Command");
    expect(options?.timeout).toBe(15000);
  },
);

it.runIf(process.platform === "win32")(
  "文稿只经过 JSON 文件，进度与取消信号传给 Windows 语音进程",
  async () => {
    const root = path.resolve(`test-output/windows-speech-unit-${Date.now()}`);
    await fs.mkdir(root, { recursive: true });
    const request = path.join(root, "request.json");
    const output = path.join(root, "speech.wav");
    const options = {
      text: '中文、引号"与 $() 都是普通文稿',
      engine: "windows-sapi" as const,
      voice: "auto",
      offline: true,
    };
    const signal = new AbortController().signal;
    const progress = vi.fn();
    vi.mocked(runProcess).mockImplementationOnce(
      async (_binary, args, configuration) => {
        expect(args).not.toContain(options.text);
        expect(configuration?.signal).toBe(signal);
        configuration?.onLine?.(
          'TRONCUT_PROGRESS {"percent":50,"label":"Windows TTS"}',
        );
        return "";
      },
    );
    await synthesizeWindowsSpeech(
      options,
      path.resolve("workers/onnx"),
      request,
      output,
      signal,
      progress,
    );
    expect(JSON.parse(await fs.readFile(request, "utf8"))).toEqual(options);
    expect(progress).toHaveBeenCalledWith(50, "Windows TTS");
  },
);
