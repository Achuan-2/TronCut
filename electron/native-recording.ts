import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { Asset } from "../shared/model";
import { cursorRecordingSchema } from "../shared/model";
import { findBinary } from "./process";
import { probeMedia } from "./media";
import type { CursorSample } from "../shared/cursor";
import { cursorType } from "../shared/cursor";
import { recordingName } from "./recording-name";

export class NativeRecording {
  private capture?: ChildProcessWithoutNullStreams;
  private sampler?: ChildProcessWithoutNullStreams;
  private startedAt = 0;
  private pausedAt = 0;
  private pausedMs = 0;
  private samples: CursorSample[] = [];
  private error = "";
  private completion?: Promise<void>;
  private completed = false;
  private output = "";
  private aborted = false;
  private startReady?: Promise<void>;
  private startSampling?: () => void;

  async prepare(
    config: Record<string, unknown>,
    folder: string,
    resourcesPath: string | undefined,
    displayBounds: { x: number; y: number; width: number; height: number },
    onUnexpectedStop: () => void,
  ) {
    await fs.mkdir(folder, { recursive: true });
    if (this.aborted) throw new Error("录制准备已取消");
    this.output = path.join(folder, `${recordingName()}.mp4`);
    const capture = spawn(
      findBinary("wgc-capture", resourcesPath),
      [
        JSON.stringify({
          ...config,
          screenPath: this.output,
          captureCursor: false,
          waitForStart: true,
        }),
      ],
      { windowsHide: true, shell: false },
    );
    this.capture = capture;
    capture.stdin.on("error", () => {}); // The source/helper may close before a command write.
    let prepared!: () => void, failed!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      prepared = resolve;
      failed = reject;
    });
    let recordingStarted!: () => void, startFailed!: (error: Error) => void;
    this.startReady = new Promise<void>((resolve, reject) => {
      recordingStarted = resolve;
      startFailed = reject;
    });
    void this.startReady.catch(() => {});
    let done!: () => void, failure!: (error: Error) => void;
    this.completion = new Promise<void>((resolve, reject) => {
      done = resolve;
      failure = reject;
    });
    void this.completion.catch(() => {});
    let pending = "";
    capture.stderr.on("data", (chunk) => {
      this.error = (this.error + chunk).slice(-8000);
    });
    capture.stdout.on("data", (chunk) => {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("{")) continue;
        try {
          const event = JSON.parse(line);
          if (event.event === "recording-prepared") prepared();
          if (event.event === "recording-started") {
            this.startedAt = Date.now();
            recordingStarted();
          }
          if (event.event === "recording-stopped") this.completed = true;
        } catch {
          /* Diagnostic lines are not part of the JSON event channel. */
        }
      }
    });
    const timeout = setTimeout(() => {
      capture.stdin.end("stop\n");
      failed(new Error("原生录制启动超时"));
    }, 20000);
    capture.on("error", (e) => {
      clearTimeout(timeout);
      failed(e);
      startFailed(e);
      failure(e);
    });
    capture.on("close", (code) => {
      clearTimeout(timeout);
      const error = new Error(
        `原生录制退出 (${code})：${this.error.slice(-2000)}`,
      );
      if (!this.startedAt) failed(error);
      startFailed(error);
      if (this.completed) done();
      else failure(error);
      if (this.startedAt && !this.completed) onUnexpectedStop();
    });
    try {
      await ready;
    } finally {
      clearTimeout(timeout);
    }
    this.startSampling = () => this.sampleCursor(config, resourcesPath, displayBounds);
  }

  async start() {
    if (this.aborted || !this.capture || !this.startReady)
      throw new Error("原生录制尚未准备好");
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      this.capture.stdin.write("start\n");
      await Promise.race([
        this.startReady,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error("原生录制启动超时")), 15000);
        }),
      ]);
      this.startSampling?.();
    } finally {
      clearTimeout(timeout);
    }
  }

  private sampleCursor(
    config: Record<string, unknown>,
    resourcesPath: string | undefined,
    displayBounds: { x: number; y: number; width: number; height: number },
  ) {
    const handle =
      typeof config.sourceId === "string"
        ? config.sourceId.match(/^window:(\d+):/)?.[1]
        : undefined;
    const sampler = spawn(
      findBinary("cursor-sampler", resourcesPath),
      ["50", handle ?? "null"],
      { windowsHide: true, shell: false },
    );
    this.sampler = sampler;
    let data = "";
    sampler.on("error", (e) => {
      this.error += `\n鼠标采样失败：${e.message}`;
    });
    sampler.stdout.on("data", (chunk) => {
      data += chunk;
      const lines = data.split(/\r?\n/);
      data = lines.pop() ?? "";
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          if (
            event.type !== "sample" ||
            this.pausedAt ||
            this.samples.length >= 500000
          )
            continue;
          const bounds = event.bounds ?? displayBounds;
          const sample = {
            time: Math.max(
              0,
              (event.timestampMs - this.startedAt - this.pausedMs) / 1000,
            ),
            x: (event.x - bounds.x) / bounds.width,
            y: (event.y - bounds.y) / bounds.height,
            visible: !!event.visible,
            click: !!event.leftButtonPressed,
            cursorType: cursorType(event.cursorType),
          };
          if (
            !Number.isFinite(sample.time) ||
            !Number.isFinite(sample.x) ||
            !Number.isFinite(sample.y)
          )
            continue;
          // Keep the first/last points of stationary spans, so interpolation doesn't anticipate the next move.
          const last = this.samples.at(-1),
            before = this.samples.at(-2);
          if (
            last &&
            before &&
            !sample.click &&
            !last.click &&
            last.x === sample.x &&
            last.y === sample.y &&
            before.x === last.x &&
            before.y === last.y &&
            last.visible === sample.visible &&
            before.visible === last.visible &&
            last.cursorType === sample.cursorType &&
            before.cursorType === last.cursorType
          )
            this.samples[this.samples.length - 1] = sample;
          else this.samples.push(sample);
        } catch {
          /* Ignore an incomplete native sample; never invent a point. */
        }
      }
    });
  }

  pause(paused: boolean) {
    if (paused && !this.pausedAt) {
      this.pausedAt = Date.now();
      this.capture?.stdin.write("pause\n");
    } else if (!paused && this.pausedAt) {
      this.pausedMs += Date.now() - this.pausedAt;
      this.pausedAt = 0;
      this.capture?.stdin.write("resume\n");
    }
  }

  async stop(resourcesPath?: string): Promise<Asset> {
    this.sampler?.kill();
    this.sampler = undefined;
    if (this.capture?.exitCode === null) this.capture.stdin.end("stop\n");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.completion,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            this.capture?.kill();
            reject(new Error("原生录制停止超时，录制文件保留在录制目录"));
          }, 60000);
        }),
      ]);
      const asset = await probeMedia(this.output, resourcesPath);
      asset.cursor = cursorRecordingSchema.parse({
        samples: this.samples
          .filter((s) => s.time <= asset.duration)
          .sort((a, b) => a.time - b.time),
      });
      await fs.writeFile(
        `${this.output}.cursor.json`,
        JSON.stringify(asset.cursor),
      );
      return asset;
    } finally {
      clearTimeout(timer);
    }
  }

  async abort() {
    this.aborted = true;
    this.sampler?.kill();
    const capture = this.capture;
    if (this.startedAt) {
      if (capture?.exitCode === null) capture.stdin.end("stop\n");
      return;
    }
    if (capture && capture.exitCode === null && capture.signalCode === null) {
      // A prepared helper may still be inside device initialization and not
      // reading stdin yet. Terminate it so cancelling never waits for drivers.
      const closed = new Promise<void>((resolve) => capture.once("close", () => resolve()));
      capture.kill();
      await closed;
    }
    if (!this.startedAt && this.output)
      await fs.rm(this.output, { force: true }).catch(() => {});
  }
}
