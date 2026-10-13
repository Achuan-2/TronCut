import { describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { ttsOptionsSchema, ttsWorkerArguments } from "../shared/tts";
import { synthesizeSpeech } from "../electron/synthesis";
import { createProject, validateProject } from "../shared/model";
import { addMediaAssets } from "../shared/editor";
import { saveProject, openProject } from "../electron/project-store";

vi.mock("../electron/process", () => ({
  findBinary: (name: string) => name,
  runProcess: vi.fn(),
}));
vi.mock("../electron/media", () => ({ probeMedia: vi.fn() }));
import { runProcess } from "../electron/process";
import { probeMedia } from "../electron/media";

const options = {
  text: "中文配音",
  engine: "kokoro" as const,
  voice: "zf_001",
};
describe("本地配音", () => {
  it("拒绝空文稿、跨模型音色及不支持的语气指令", () => {
    expect(ttsOptionsSchema.safeParse({ ...options, text: "  " }).success).toBe(
      false,
    );
    expect(
      ttsOptionsSchema.safeParse({ ...options, voice: "Vivian" }).success,
    ).toBe(false);
    expect(
      ttsOptionsSchema.safeParse({ ...options, instruction: "自然讲解" })
        .success,
    ).toBe(false);
    expect(
      ttsOptionsSchema.safeParse({ ...options, language: "en" }).success,
    ).toBe(false);
    expect(
      ttsOptionsSchema.parse({
        ...options,
        engine: "qwen-quality",
        voice: "Vivian",
        instruction: "自然讲解",
      }).instruction,
    ).toBe("自然讲解");
  });
  it("通过 JSON 文件传文稿，离线与 CUDA 依赖按需启用", () => {
    const args = ttsWorkerArguments(
      { ...options, device: "cuda", offline: true },
      "C:/space path/tts",
      "C:/space path/request.json",
      "C:/space path/audio.wav",
    );
    expect(args).toContain("--offline");
    expect(args).toContain("--frozen");
    expect(args).toContain("cuda");
    expect(args).toContain("C:/space path/request.json");
    expect(args).not.toContain(options.text);
  });
  it("生成素材保留文稿参数，工程往返可读取，失败输出被清理", async () => {
    const userData = path.resolve("test-output/tts/service");
    await fs.rm(userData, { recursive: true, force: true });
    const worker = vi.mocked(runProcess);
    worker.mockImplementation(async (binary, args) => {
      if (args.length === 1) return "version";
      if (binary === "uv") {
        await fs.writeFile(args.at(-1)!, "raw");
        await fs.writeFile(`${args.at(-1)}.json`, "{}");
      } else await fs.writeFile(args.at(-1)!, "wav");
      return "";
    });
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
      workers: path.resolve("workers/tts"),
      resources: "resources",
    };
    const asset = await synthesizeSpeech(
      options,
      paths,
      new AbortController().signal,
      () => {},
    );
    const project = createProject();
    project.assets = [asset];
    expect(
      validateProject(JSON.parse(JSON.stringify(project))).assets[0].narration
        ?.text,
    ).toBe(options.text);
    expect(await fs.readFile(asset.path, "utf8")).toBe("wav");
    expect(asset.name).toMatch(/\.wav$/);
    expect(await fs.readdir(path.dirname(asset.path))).toEqual([
      "narration.json",
      "narration.wav",
    ]);
    const withClip = addMediaAssets(createProject(), [asset], 4, true);
    expect(withClip.clips[0]).toMatchObject({
      kind: "audio",
      start: 4,
      duration: 2,
      trackId: "audio",
    });
    const projectFile = path.join(userData, "saved-project", "配音.troncut");
    await saveProject(withClip, projectFile);
    const reopened = await openProject(projectFile);
    expect(reopened.assets[0].narration).toEqual(asset.narration);
    expect(reopened.assets[0].path).toMatch(/\.wav$/);
    expect(await fs.readFile(reopened.assets[0].path, "utf8")).toBe("wav");
    const before = await fs.readdir(path.join(userData, "narration"));
    worker.mockRejectedValueOnce(new Error("任务已取消"));
    await expect(
      synthesizeSpeech(options, paths, new AbortController().signal, () => {}),
    ).rejects.toThrow("任务已取消");
    expect(await fs.readdir(path.join(userData, "narration"))).toEqual(before);
  });
  it("CPU 模式准备独立 CPU 依赖，避免自动下载 CUDA 环境", () => {
    const args = ttsWorkerArguments(options, "workers", "request", "output");
    expect(args).toContain("cpu");
    expect(args).not.toContain("cuda");
  });
  it("IndexTTS 必须选择参考音频，使用独立 Python 3.11 环境", () => {
    const index = {
      ...options,
      engine: "indextts" as const,
      voice: "reference",
      referenceAssetId: "reference-audio",
      device: "cuda" as const,
    };
    expect(
      ttsOptionsSchema.safeParse({ ...index, referenceAssetId: undefined })
        .success,
    ).toBe(false);
    expect(
      ttsOptionsSchema.safeParse({ ...index, device: "mps" }).success,
    ).toBe(false);
    const args = ttsWorkerArguments(
      index,
      "workers/index",
      "request",
      "output",
    );
    expect(args).toContain("3.11");
    expect(args).toContain("cuda");
    expect(args).not.toContain("qwen");
    expect(args).not.toContain("indextts");
  });
  it("IndexTTS 只使用主进程解析的参考文件，参考音频随工程往返保存", async () => {
    const userData = path.resolve("test-output/tts/index-service");
    const index = {
      ...options,
      engine: "indextts" as const,
      voice: "reference",
      referenceAssetId: "reference-audio",
      device: "auto" as const,
    };
    let request: Record<string, unknown> | undefined;
    vi.mocked(runProcess).mockImplementation(
      async (binary, args, processOptions) => {
        if (binary === "nvidia-smi") return "RTX 4050";
        if (args.length === 1) return "version";
        if (binary === "uv") {
          request = JSON.parse(
            await fs.readFile(args[args.indexOf("--request") + 1], "utf8"),
          );
          expect(processOptions?.env?.UV_PROJECT_ENVIRONMENT).toContain(
            ".venv-indextts-cuda",
          );
          expect(processOptions?.env?.TRONCUT_INDEXTTS_MODELS).toBe(
            path.join(userData, "models", "indextts2_5"),
          );
        }
        await fs.writeFile(args.at(-1)!, "audio");
        return "";
      },
    );
    vi.mocked(probeMedia).mockImplementationOnce(async (file) => ({
      id: "cloned",
      name: "speech",
      path: file,
      kind: "audio",
      duration: 2,
      width: 0,
      height: 0,
      hasAudio: true,
    }));
    const referenceAudio = path.join(userData, "source.wav");
    await fs.mkdir(userData, { recursive: true });
    await fs.writeFile(referenceAudio, "reference");
    const asset = await synthesizeSpeech(
      index,
      {
        userData,
        workers: path.resolve("workers/indextts"),
        resources: "resources",
        referenceAudio,
      },
      new AbortController().signal,
      () => {},
    );
    expect(request?.device).toBe("cuda");
    expect(request?.referenceAudio).toBe(
      path.join(path.dirname(asset.path), "reference.wav"),
    );
    expect(await fs.readdir(path.dirname(asset.path))).toEqual([
      "narration.json",
      "narration.wav",
    ]);
    const project = createProject();
    project.assets = [
      asset,
      {
        id: "reference-audio",
        name: "参考.wav",
        path: referenceAudio,
        kind: "audio",
        duration: 3,
        width: 0,
        height: 0,
        hasAudio: true,
      },
    ];
    const projectFile = path.join(userData, "saved", "IndexTTS.troncut");
    await saveProject(project, projectFile);
    const reopened = await openProject(projectFile);
    expect(reopened.assets[0].narration?.referenceAssetId).toBe(
      "reference-audio",
    );
    expect(await fs.readFile(reopened.assets[1].path, "utf8")).toBe(
      "reference",
    );
  });
  it("没有 NVIDIA 驱动时在下载模型之前拒绝显式 CUDA 配音", async () => {
    vi.mocked(runProcess).mockImplementation(async (binary) => {
      if (binary === "nvidia-smi") throw new Error("ENOENT");
      return "version";
    });
    const index = {
      ...options,
      engine: "indextts" as const,
      voice: "reference",
      referenceAssetId: "reference",
      device: "cuda" as const,
    };
    await expect(
      synthesizeSpeech(
        index,
        {
          userData: "unused",
          workers: "unused",
          resources: "resources",
          referenceAudio: "authorized.wav",
        },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("NVIDIA 驱动");
  });
  it("探测音频期间取消时也清理输出，不返回成功素材", async () => {
    const controller = new AbortController();
    const userData = path.resolve("test-output/tts/late-cancel");
    vi.mocked(runProcess).mockImplementation(async (_binary, args) => {
      if (args.length > 1) await fs.writeFile(args.at(-1)!, "audio");
      return "";
    });
    vi.mocked(probeMedia).mockImplementationOnce(async (file) => {
      controller.abort();
      return {
        id: "cancelled",
        name: "speech",
        path: file,
        kind: "audio",
        duration: 2,
        width: 0,
        height: 0,
        hasAudio: true,
      };
    });
    await expect(
      synthesizeSpeech(
        options,
        {
          userData,
          workers: path.resolve("workers/tts"),
          resources: "resources",
        },
        controller.signal,
        () => {},
      ),
    ).rejects.toThrow("配音已取消");
    expect(await fs.readdir(path.join(userData, "narration"))).toEqual([]);
  });
});
