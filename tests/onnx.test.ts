import fs from "node:fs/promises";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { downloadOnnxModel, runOnnxWorker } from "../electron/onnx";
import { runProcess } from "../electron/process";

vi.mock("../electron/process", () => ({
  findBinary: (name: string) => name,
  runProcess: vi.fn(),
}));

it("模型下载不依赖文稿或媒体，下载到应用缓存并返回就绪目录", async () => {
  const temp = path.resolve(`test-output/onnx-download-${Date.now()}`);
  await fs.mkdir(temp, { recursive: true });
  const events: number[] = [];
  vi.mocked(runProcess).mockImplementation(async (_binary, args, options) => {
    expect(args).toContain("--frozen");
    expect(args).not.toContain("--offline");
    expect(args).toContain(path.join(temp, "request.json"));
    expect(
      JSON.parse(await fs.readFile(path.join(temp, "request.json"), "utf8")),
    ).toEqual({ engine: "sensevoice" });
    const directory = path.join(temp, "profile/models/onnx/sensevoice-small");
    expect(options?.env?.TRONCUT_ONNX_MODELS).toBe(path.dirname(directory));
    options?.onLine?.('TRONCUT_PROGRESS {"percent":50,"label":"正在下载模型"}');
    await fs.writeFile(
      args.at(-1)!,
      JSON.stringify({ engine: "sensevoice", directory }),
    );
    return "";
  });
  const result = await downloadOnnxModel(
    "sensevoice",
    {
      temp,
      userData: path.join(temp, "profile"),
      workers: path.resolve("workers/onnx"),
      resources: "",
    },
    new AbortController().signal,
    (percent) => events.push(percent),
  );
  expect(result.engine).toBe("sensevoice");
  expect(events).toContain(50);
});

it("工作进程取消或失败后清理该任务的下载暂存目录", async () => {
  const root = path.resolve(`test-output/onnx-cancel-${Date.now()}`);
  let staging = "";
  vi.mocked(runProcess).mockImplementationOnce(
    async (_binary, _args, options) => {
      staging = options!.env!.TRONCUT_ONNX_DOWNLOAD_TEMP!;
      await fs.writeFile(path.join(staging, "partial-model.onnx"), "partial");
      throw new Error("任务已取消");
    },
  );
  await expect(
    runOnnxWorker("uv", ["run"], { env: { TRONCUT_ONNX_MODELS: root } }),
  ).rejects.toThrow("任务已取消");
  expect(staging.startsWith(root + path.sep)).toBe(true);
  expect(await fs.readdir(root)).toEqual([]);
});
