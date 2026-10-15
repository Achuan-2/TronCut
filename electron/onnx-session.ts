import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { runProcess } from "./process";

type Options = NonNullable<Parameters<typeof runProcess>[2]>;
type ActiveRequest = {
  id: string;
  onLine?: Options["onLine"];
  resolve: (value: string) => void;
  reject: (error: Error) => void;
};

/** One serial inference worker per application-data environment. */
class OnnxSession {
  private child?: ChildProcessWithoutNullStreams;
  private closed: Promise<void> = Promise.resolve();
  private tail: Promise<unknown> = Promise.resolve();
  private active?: ActiveRequest;
  private disposed = false;

  run(binary: string, args: string[], options: Options): Promise<string> {
    // Reject queued cancellation immediately, without stopping another request.
    return new Promise((resolve, reject) => {
      let started = false;
      const cancel = () => {
        if (!started) reject(new Error("任务已取消"));
      };
      options.signal?.addEventListener("abort", cancel, { once: true });
      if (options.signal?.aborted) cancel();
      const task = this.tail.then(async () => {
        started = true;
        if (options.signal?.aborted) throw new Error("任务已取消");
        return this.execute(binary, args, options);
      });
      this.tail = task.catch(() => {});
      void task.then(resolve, reject).finally(() => {
        options.signal?.removeEventListener("abort", cancel);
      });
    });
  }

  private async start(binary: string, args: string[], options: Options) {
    if (this.disposed) throw new Error("ONNX 运行环境已关闭");
    if (this.child && this.child.exitCode !== null) await this.closed;
    if (this.child) return;
    // Sync once per session, then launch Python directly so cancellation cannot
    // orphan a Python child of uv. Offline applies to both sync and each request.
    await runProcess(
      binary,
      [
        "sync",
        "--project",
        options.cwd!,
        "--python",
        "3.12",
        "--frozen",
        ...(args.includes("--offline") ? ["--offline"] : []),
      ],
      options,
    );
    if (this.disposed || options.signal?.aborted) throw new Error("任务已取消");
    const environment = options.env!.UV_PROJECT_ENVIRONMENT!;
    const python = path.join(
      environment,
      process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
    );
    const child = spawn(python, ["-u", path.join(options.cwd!, "server.py")], {
      windowsHide: true,
      shell: false,
      cwd: options.cwd,
      env: options.env,
    });
    this.child = child;
    let pending = "",
      errors = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("TRONCUT_RESULT ")) {
          this.active?.onLine?.(line);
          continue;
        }
        try {
          const result = JSON.parse(line.slice("TRONCUT_RESULT ".length));
          if (result.id !== this.active?.id) continue;
          const active = this.active!;
          this.active = undefined;
          errors = "";
          result.ok === true
            ? active.resolve("")
            : active.reject(
                new Error(`ONNX 执行失败：${String(result.error)}`),
              );
        } catch {
          errors = "ONNX 工作进程返回了无效结果";
          child.kill();
        }
      }
    });
    child.stderr.on("data", (chunk: string) => {
      errors = (errors + chunk).slice(-16000);
    });
    child.on("error", (error) => {
      errors = `无法运行 ONNX 工作进程：${error.message}`;
    });
    child.stdin.on("error", (error) => {
      errors = `无法提交 ONNX 任务：${error.message}`;
      child.kill();
    });
    this.closed = new Promise((resolve) => {
      child.once("close", (code) => {
        if (this.child === child) this.child = undefined;
        this.active?.reject(
          new Error(`ONNX 工作进程退出 (${code})：${errors.slice(-5000)}`),
        );
        this.active = undefined;
        resolve();
      });
    });
  }

  private async execute(binary: string, args: string[], options: Options) {
    await this.start(binary, args, options);
    const child = this.child!;
    this.reference(true);
    const cancel = () => {
      child.kill();
    };
    options.signal?.addEventListener("abort", cancel, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    if (options.timeout)
      timer = setTimeout(() => {
        timedOut = true;
        cancel();
      }, options.timeout);
    try {
      if (options.signal?.aborted) {
        cancel();
        throw new Error("任务已取消");
      }
      return await new Promise<string>((resolve, reject) => {
        const id = randomUUID();
        this.active = { id, onLine: options.onLine, resolve, reject };
        const script = args.find((arg) =>
          ["synthesize.py", "transcribe.py"].includes(path.basename(arg)),
        );
        child.stdin.write(
          JSON.stringify({
            id,
            script: path.basename(script!),
            request: args[args.indexOf("--request") + 1],
            output: args[args.indexOf("--output") + 1],
            downloadTemp: options.env!.TRONCUT_ONNX_DOWNLOAD_TEMP,
          }) + "\n",
        );
      });
    } catch (error) {
      if (options.signal?.aborted || timedOut) {
        await this.closed;
        throw new Error(timedOut ? "ONNX 执行超时" : "任务已取消");
      }
      throw error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancel);
      this.reference(false);
    }
  }

  private reference(ref: boolean) {
    const child = this.child;
    if (!child) return;
    // Idle workers must not keep standalone CLI/integration scripts alive.
    if (ref) child.ref();
    else child.unref();
    for (const pipe of [child.stdin, child.stdout, child.stderr]) {
      const handle = pipe as typeof pipe & {
        ref?: () => void;
        unref?: () => void;
      };
      if (ref) handle.ref?.();
      else handle.unref?.();
    }
  }

  async close() {
    this.disposed = true;
    // Keep the event loop alive until the idle child's close event is observed.
    this.reference(true);
    this.child?.kill();
    await this.closed;
    await this.tail;
  }

  stop() {
    this.disposed = true;
    this.child?.kill();
  }
}

const sessions = new Map<string, OnnxSession>();
process.once("exit", () => {
  for (const session of sessions.values()) session.stop();
});

export function runOnnxSession(
  binary: string,
  args: string[],
  options: Options,
) {
  if (!options.cwd || !options.env?.UV_PROJECT_ENVIRONMENT)
    throw new Error("缺少 ONNX 工作进程运行环境");
  const key = JSON.stringify([
    binary,
    path.resolve(options.cwd),
    options.env.UV_PROJECT_ENVIRONMENT,
    options.env.TRONCUT_ONNX_MODELS,
  ]);
  let session = sessions.get(key);
  if (!session) {
    session = new OnnxSession();
    sessions.set(key, session);
  }
  return session.run(binary, args, options);
}

export async function closeOnnxSessions() {
  const current = [...sessions.values()];
  sessions.clear();
  await Promise.all(current.map((session) => session.close()));
}
