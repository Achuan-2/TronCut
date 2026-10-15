import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { findBinary } from "./process";

export class RecordingBorder {
  private child?: ChildProcessWithoutNullStreams;

  async start(
    sourceId: string,
    bounds: { x: number; y: number; width: number; height: number },
    resourcesPath: string | undefined,
    onUnexpectedStop: () => void,
  ) {
    if (process.platform !== "win32") return;
    await this.stop();
    const handle = sourceId.match(/^window:(\d+):/)?.[1];
    if (!handle && !sourceId.startsWith("screen:"))
      throw new Error("无法确定录制边框的目标");
    const args = handle
      ? ["--window", handle, String(process.pid)]
      : [
          "--display",
          ...[bounds.x, bounds.y, bounds.width, bounds.height, process.pid].map(
            String,
          ),
        ];
    const child = spawn(findBinary("recording-border", resourcesPath), args, {
      windowsHide: true,
      shell: false,
    });
    this.child = child;
    let ready = false,
      pending = "",
      diagnostic = "";
    child.stdin.on("error", () => {}); // The target may close before the stop command.
    child.stderr.on("data", (chunk) => {
      diagnostic = (diagnostic + chunk).slice(-2000);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("录制区域边框启动超时")),
          5000,
        );
        const fail = (error: Error) => {
          clearTimeout(timeout);
          reject(error);
        };
        child.once("error", fail);
        child.once("close", () => {
          clearTimeout(timeout);
          if (!ready) reject(new Error(`无法显示录制区域边框：${diagnostic}`));
          else if (this.child === child) {
            this.child = undefined;
            onUnexpectedStop();
          }
        });
        child.stdout.on("data", (chunk) => {
          pending += chunk;
          const lines = pending.split(/\r?\n/);
          pending = lines.pop() ?? "";
          for (const line of lines) {
            try {
              if (JSON.parse(line).event === "ready") {
                ready = true;
                clearTimeout(timeout);
                resolve();
              }
            } catch {
              /* Ignore native diagnostics. */
            }
          }
        });
      });
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop() {
    const child = this.child;
    this.child = undefined;
    if (!child || child.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        child.kill();
        resolve();
      }, 1500);
      child.once("close", () => {
        clearTimeout(timeout);
        resolve();
      });
      child.stdin.end("stop\n");
    });
  }
}
