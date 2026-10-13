import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function findBinary(name: string, resourcesPath?: string): string {
  const configured = process.env[`FRAMECRAFT_${name.toUpperCase()}`];
  if (configured) return configured;
  const executable = name + (process.platform === "win32" ? ".exe" : "");
  for (const folder of [
    resourcesPath && path.join(resourcesPath, "bin"),
    path.resolve("resources/bin"),
  ]) {
    if (folder && fs.existsSync(path.join(folder, executable)))
      return path.join(folder, executable);
  }
  return executable;
}
export function runProcess(
  binary: string,
  args: string[],
  options: {
    signal?: AbortSignal;
    onLine?: (line: string) => void;
    cwd?: string;
    timeout?: number;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Error("任务已取消"));
      return;
    }
    const child = spawn(binary, args, {
      windowsHide: true,
      shell: false,
      cwd: options.cwd,
      env: options.env,
      detached: process.platform !== "win32",
    });
    let output = "",
      error = "",
      pending = "";
    let timedOut = false;
    const stop = () => {
      if (!child.pid || child.exitCode !== null) return;
      if (process.platform === "win32") {
        // uv launches Python as a child: terminating only uv would leave inference running.
        const killer = spawn(
          "taskkill",
          ["/PID", String(child.pid), "/T", "/F"],
          { windowsHide: true, shell: false },
        );
        killer.on("error", () => child.kill());
        killer.on("exit", (code) => {
          if (code) child.kill();
        });
      } else {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill();
        }
      }
    };
    options.signal?.addEventListener("abort", stop, { once: true });
    const clean = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", stop);
    };
    const timer = options.timeout
      ? setTimeout(() => {
          timedOut = true;
          stop();
        }, options.timeout)
      : undefined;
    child.stdout.on("data", (chunk) => {
      output = (output + chunk).slice(-2_000_000);
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      lines.forEach((line) => options.onLine?.(line));
    });
    child.stderr.on("data", (chunk) => {
      error = (error + chunk).slice(-16000);
    });
    child.once("error", (err) => {
      clean();
      reject(new Error(`无法运行 ${path.basename(binary)}：${err.message}`));
    });
    child.once("close", (code) => {
      clean();
      if (pending) options.onLine?.(pending);
      code === 0 && !options.signal?.aborted && !timedOut
        ? resolve(output)
        : reject(
            new Error(
              options.signal?.aborted
                ? "任务已取消"
                : timedOut
                  ? `${path.basename(binary)} 执行超时`
                  : `${path.basename(binary)} 执行失败 (${code})：${error.slice(-5000)}`,
            ),
          );
    });
  });
}
