import { describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { ttsOptionsSchema, ttsWorkerArguments } from "../shared/tts";
import { synthesizeSpeech } from "../electron/synthesis";
import { createProject, validateProject } from "../shared/model";
import { addMediaAssets } from "../shared/editor";
import { saveProject, openProject } from "../electron/project-store";
import { runProcess } from "../electron/process";
import { probeMedia } from "../electron/media";

vi.mock("../electron/process", () => ({
  findBinary: (name: string) => name,
  runProcess: vi.fn(),
}));
vi.mock("../electron/onnx-session", async () => {
  const { runProcess } = await import("../electron/process");
  return { runOnnxSession: runProcess };
});
vi.mock("../electron/media", () => ({ probeMedia: vi.fn() }));

const options = {
  text: "中文配音",
  engine: "kokoro-onnx" as const,
  voice: "10",
  modelDir: "C:/我的模型/kokoro",
};
const runtime = {
  model: "kokoro-onnx",
  device: "cpu",
  precision: "int8",
  sampleRate: 24000,
  duration: 2,
  loadSeconds: 1,
  generationSeconds: 1,
  modelDirectory: options.modelDir,
};

describe("ONNX 本地配音", () => {
  it("验证文稿、音色、语言和 CPU 环境", () => {
    for (const patch of [
      { text: " " },
      { voice: "Vivian" },
      { voice: "103" },
      { device: "cuda" },
      { instruction: "自然讲解" },
    ])
      expect(ttsOptionsSchema.safeParse({ ...options, ...patch }).success).toBe(
        false,
      );
    expect(
      ttsOptionsSchema.safeParse({ ...options, language: "en" }).success,
    ).toBe(true);
    expect(
      ttsOptionsSchema.safeParse({
        ...options,
        engine: "vits-onnx",
        voice: "173",
        language: "en",
      }).success,
    ).toBe(false);
    expect(
      ttsOptionsSchema.safeParse({
        ...options,
        engine: "vits-onnx",
        voice: "173",
      }).success,
    ).toBe(true);
  });
  it("文稿通过 JSON 文件传递，锁定 ONNX 环境并支持严格离线", () => {
    const args = ttsWorkerArguments(
      { ...options, offline: true },
      "C:/space path/onnx",
      "C:/space path/request.json",
      "audio.wav",
    );
    expect(args).toContain("--offline");
    expect(args).toContain("--frozen");
    expect(args).toContain("C:/space path/request.json");
    expect(args).not.toContain(options.text);
    expect(args).not.toContain("--extra");
  });
  it("旧配音参数仍能解析和打开工程，但不启动旧推理环境", async () => {
    for (const legacy of [
      { engine: "kokoro", voice: "zf_001" },
      { engine: "qwen-small", voice: "Vivian" },
      { engine: "qwen-quality", voice: "Vivian", instruction: "自然" },
      { engine: "indextts", voice: "reference", referenceAssetId: "reference" },
    ]) {
      const narration = ttsOptionsSchema.parse({ text: "旧文稿", ...legacy });
      const project = createProject();
      project.assets = [
        {
          id: "a",
          name: "旧配音",
          path: "old.wav",
          kind: "audio",
          duration: 2,
          width: 0,
          height: 0,
          hasAudio: true,
          narration,
        },
      ];
      expect(validateProject(project).assets[0].narration?.engine).toBe(
        legacy.engine,
      );
      await expect(
        synthesizeSpeech(
          narration,
          { userData: "unused", workers: "unused", resources: "" },
          new AbortController().signal,
          () => {},
        ),
      ).rejects.toThrow("配音已改用 ONNX");
    }
  });
  it("保留模型参数、运行记录和工程素材，语速仅转换一次", async () => {
    const userData = path.resolve(`test-output/tts/onnx-${Date.now()}`);
    const calls: string[][] = [];
    vi.mocked(runProcess).mockImplementation(
      async (binary, args, processOptions) => {
        calls.push(args);
        if (args.length === 1) return "version";
        if (binary === "uv") {
          const request = JSON.parse(
            await fs.readFile(args[args.indexOf("--request") + 1], "utf8"),
          );
          expect(request).toMatchObject({
            ...options,
            device: "cpu",
            speed: 1.25,
          });
          expect(processOptions?.env?.UV_PROJECT_ENVIRONMENT).toBe(
            path.join(userData, "workers/onnx/.venv"),
          );
          await fs.writeFile(args.at(-1)!, "raw");
          await fs.writeFile(`${args.at(-1)}.json`, JSON.stringify(runtime));
        } else await fs.writeFile(args.at(-1)!, "wav");
        return "";
      },
    );
    vi.mocked(probeMedia).mockImplementation(async (file) => ({
      id: "speech",
      name: "speech",
      path: file,
      kind: "audio",
      duration: 2,
      width: 0,
      height: 0,
      hasAudio: true,
    }));
    const paths = {
      userData,
      workers: path.resolve("workers/onnx"),
      resources: "resources",
    };
    const asset = await synthesizeSpeech(
      { ...options, speed: 1.25 },
      paths,
      new AbortController().signal,
      () => {},
    );
    expect(calls.filter((args) => args.includes("atempo=1.25"))).toHaveLength(
      1,
    );
    expect(await fs.readdir(path.dirname(asset.path))).toEqual([
      "narration.json",
      "narration.wav",
    ]);
    const metadata = JSON.parse(
      await fs.readFile(
        path.join(path.dirname(asset.path), "narration.json"),
        "utf8",
      ),
    );
    expect(metadata.runtime).toEqual(runtime);
    const project = addMediaAssets(createProject(), [asset], 4, true);
    expect(project.clips[0]).toMatchObject({
      kind: "audio",
      start: 4,
      duration: 2,
    });
    const projectFile = path.join(userData, "saved/配音.troncut");
    await saveProject(project, projectFile);
    const reopened = await openProject(projectFile);
    expect(reopened.assets[0].narration).toEqual(asset.narration);
    expect(await fs.readFile(reopened.assets[0].path, "utf8")).toBe("wav");

    const before = await fs.readdir(path.join(userData, "narration"));
    vi.mocked(probeMedia).mockRejectedValueOnce(new Error("无效音频"));
    await expect(
      synthesizeSpeech(
        { ...options, speed: 1.25 },
        paths,
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("无效音频");
    expect(await fs.readdir(path.join(userData, "narration"))).toEqual(before);

    const controller = new AbortController();
    vi.mocked(probeMedia).mockImplementationOnce(async () => {
      controller.abort();
      return asset;
    });
    await expect(
      synthesizeSpeech(
        { ...options, speed: 1.25 },
        paths,
        controller.signal,
        () => {},
      ),
    ).rejects.toThrow("配音已取消");
    expect(await fs.readdir(path.join(userData, "narration"))).toEqual(before);
  });
});
