import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  onnxModelSchema,
  onnxWorkerArguments,
  type OnnxModel,
} from "../shared/onnx";
import { findBinary, runProcess } from "./process";
import { runOnnxSession } from "./onnx-session";

export async function prepareOnnxWorker(source: string, userData: string) {
  const workers = path.join(userData, "workers", "onnx");
  await fs.mkdir(workers, { recursive: true });
  for (const file of [
    "pyproject.toml",
    "uv.lock",
    "models.py",
    "caption_utils.py",
    "model_cache.py",
    "server.py",
    "lux.py",
    "clone.py",
    "transcribe.py",
    "synthesize.py",
    "prepare.py",
  ])
    await fs.copyFile(path.join(source, file), path.join(workers, file));
  return workers;
}

export function onnxEnvironment(
  userData: string,
  workers: string,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PYTHONUTF8: "1",
    UV_CACHE_DIR: path.join(userData, "uv-cache"),
    UV_PYTHON_INSTALL_DIR: path.join(userData, "python"),
    UV_PROJECT_ENVIRONMENT: path.join(workers, ".venv"),
    TRONCUT_ONNX_MODELS: path.join(userData, "models", "onnx"),
    HF_HOME: path.join(userData, "models", "huggingface"),
  };
}

/** Keep each worker's partial downloads owned by one task, so cancellation cleans them. */
export async function runOnnxWorker(
  binary: string,
  args: string[],
  options: NonNullable<Parameters<typeof runProcess>[2]>,
  persistent = false,
) {
  const cache = options.env?.TRONCUT_ONNX_MODELS;
  if (!cache) throw new Error("缺少 ONNX 模型缓存目录");
  const root = path.resolve(cache);
  await fs.mkdir(root, { recursive: true });
  const staging = await fs.mkdtemp(path.join(root, ".download-task-"));
  try {
    return await (persistent ? runOnnxSession : runProcess)(binary, args, {
      ...options,
      env: { ...options.env, TRONCUT_ONNX_DOWNLOAD_TEMP: staging },
    });
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

/** Prepare in our own cache, without requiring a narration or an imported media asset. */
export async function downloadOnnxModel(
  engine: OnnxModel,
  paths: { workers: string; userData: string; resources: string; temp: string },
  signal: AbortSignal,
  progress: (percent: number, label: string) => void,
) {
  onnxModelSchema.parse(engine);
  progress(0, "正在准备本地 ONNX 模型下载环境");
  const workers = await prepareOnnxWorker(paths.workers, paths.userData);
  const request = path.join(paths.temp, "request.json");
  const output = path.join(paths.temp, "prepared.json");
  await fs.writeFile(request, JSON.stringify({ engine }), "utf8");
  await runOnnxWorker(
    findBinary("uv", paths.resources),
    onnxWorkerArguments(workers, "prepare.py", request, output),
    {
      signal,
      cwd: workers,
      env: onnxEnvironment(paths.userData, workers),
      onLine(line) {
        const prefix = "TRONCUT_PROGRESS ";
        if (!line.startsWith(prefix)) return;
        try {
          const event = z
            .object({
              percent: z.number().min(0).max(100),
              label: z.string().max(5000),
            })
            .parse(JSON.parse(line.slice(prefix.length)));
          progress(event.percent, event.label);
        } catch {
          /* Ignore ordinary download/runtime output. */
        }
      },
    },
  );
  if (signal.aborted) throw new Error("模型下载已取消");
  const result = z
    .object({ engine: onnxModelSchema, directory: z.string().min(1).max(4096) })
    .parse(JSON.parse(await fs.readFile(output, "utf8")));
  if (result.engine !== engine) throw new Error("模型下载结果与所选模型不一致");
  if (signal.aborted) throw new Error("模型下载已取消");
  return result;
}
