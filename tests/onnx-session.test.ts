import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { closeOnnxSessions } from "../electron/onnx-session";
import { runOnnxWorker } from "../electron/onnx";
import { runProcess } from "../electron/process";
import { onnxWorkerArguments } from "../shared/onnx";

vi.mock("../electron/process", () => ({
  findBinary: (name: string) => name,
  runProcess: vi.fn(async () => ""),
}));
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: (_binary: string, _args: string[], options: object) =>
      actual.spawn(
        process.execPath,
        [path.resolve("tests/fixtures/onnx-server.mjs")],
        options,
      ),
  };
});

afterEach(async () => {
  await closeOnnxSessions();
  vi.clearAllMocks();
});

async function setup() {
  const root = await fs.mkdtemp(path.resolve("test-output/onnx-session-"));
  let sequence = 0;
  const events: string[] = [];
  const run = async (request: object = {}, signal?: AbortSignal) => {
    const id = sequence++;
    const input = path.join(root, `request-${id}.json`);
    const output = path.join(root, `result-${id}.json`);
    await fs.writeFile(input, JSON.stringify(request));
    await runOnnxWorker(
      "uv",
      onnxWorkerArguments(root, "synthesize.py", input, output, true),
      {
        signal,
        cwd: root,
        env: {
          ...process.env,
          UV_PROJECT_ENVIRONMENT: path.join(root, ".venv"),
          TRONCUT_ONNX_MODELS: path.join(root, "models"),
        },
        onLine: (line) => events.push(line),
      },
      true,
    );
    return JSON.parse(await fs.readFile(output, "utf8")) as {
      pid: number;
      requests: number;
      messageTemp: string;
    };
  };
  return { root, run, events };
}

it("连续任务共用 Python，串行排队，每个任务独立清理下载目录", async () => {
  const { root, run, events } = await setup();
  const [first, second] = await Promise.all([run({ delay: 30 }), run()]);
  expect(first.pid).toBe(second.pid);
  // Request files are written asynchronously before enqueueing, so either
  // preparation may finish first. Both tasks must still run once, in sequence.
  expect([first.requests, second.requests].sort((a, b) => a - b)).toEqual([1, 2]);
  expect(first.messageTemp).not.toBe(second.messageTemp);
  await expect(fs.access(first.messageTemp)).rejects.toThrow();
  expect(await fs.readdir(path.join(root, "models"))).toEqual([]);
  expect(events.some((line) => line.includes("缓存进度"))).toBe(true);
  expect(runProcess).toHaveBeenCalledTimes(1);
  expect(vi.mocked(runProcess).mock.calls[0][1]).toContain("--offline");
});

it("任务失败保留常驻进程，进程崩溃后下次请求重新启动", async () => {
  const { run } = await setup();
  const first = await run();
  await expect(run({ fail: true })).rejects.toThrow("无效模型");
  expect((await run()).pid).toBe(first.pid);
  await expect(run({ crash: true })).rejects.toThrow("7");
  expect((await run()).pid).not.toBe(first.pid);
});

it("关闭空闲缓存时等待 Python 真正退出，并允许后续重新创建环境", async () => {
  const { run } = await setup();
  const first = await run();
  await closeOnnxSessions();
  expect(() => process.kill(first.pid, 0)).toThrow();
  expect((await run()).pid).not.toBe(first.pid);
});

it("取消队列中的任务不打断当前推理，取消活动任务后清理并重启", async () => {
  const { root, run } = await setup();
  const first = await run();
  const queued = new AbortController();
  const running = run({ delay: 250 });
  const waiting = run({}, queued.signal);
  const rejected = expect(waiting).rejects.toThrow("任务已取消");
  queued.abort();
  await rejected;
  expect((await running).pid).toBe(first.pid);
  const active = new AbortController();
  const cancelled = run({ delay: 5000 }, active.signal);
  const failed = expect(cancelled).rejects.toThrow("任务已取消");
  // Ensure the request reached the live worker before aborting.
  await vi.waitFor(async () => {
    expect((await fs.readdir(path.join(root, "models"))).length).toBe(1);
  });
  active.abort();
  await failed;
  expect(await fs.readdir(path.join(root, "models"))).toEqual([]);
  expect((await run()).pid).not.toBe(first.pid);
});
