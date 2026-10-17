import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Asset } from "../shared/model";
import { findBinary, runProcess } from "./process";

const proxyWidth = 1280;
const proxyHeight = 720;
const proxyExtensions = new Set([".mp4", ".m4v", ".mov"]);

export function needsPreviewProxy(asset: Asset): boolean {
  return (
    asset.kind === "video" &&
    !asset.missing &&
    proxyExtensions.has(path.extname(asset.path).toLowerCase()) &&
    asset.width * asset.height > proxyWidth * proxyHeight
  );
}

export class PreviewProxyService {
  private readonly ready = new Map<string, string>();
  private readonly known = new Map<string, string>();
  private readonly queue: Asset[] = [];
  private readonly abort = new AbortController();
  private active = 0;

  constructor(
    private readonly cacheDir: string,
    private readonly resourcesPath: string | undefined,
    private readonly onReady: (assetId: string) => void,
    private readonly maxConcurrency = 1,
  ) {}

  path(assetId: string): string | undefined {
    return this.ready.get(assetId);
  }

  dispose() {
    this.queue.length = 0;
    this.abort.abort();
  }

  request(asset: Asset) {
    if (!needsPreviewProxy(asset)) return;
    const fingerprint = `${asset.path}|${asset.width}x${asset.height}`;
    if (this.known.get(asset.id) === fingerprint) return;
    this.known.set(asset.id, fingerprint);
    this.ready.delete(asset.id);
    this.queue.push(asset);
    this.pump();
  }

  private pump() {
    while (this.active < this.maxConcurrency && this.queue.length) {
      const asset = this.queue.shift()!;
      this.active++;
      void this.prepare(asset)
        .catch(() => {
          this.known.delete(asset.id);
        })
        .finally(() => {
          this.active--;
          this.pump();
        });
    }
  }

  private async prepare(asset: Asset): Promise<string> {
    const fingerprint = `${asset.path}|${asset.width}x${asset.height}`;
    const info = await fs.stat(asset.path);
    const key = createHash("sha256")
      .update(
        `${asset.path}|${info.size}|${info.mtimeMs}|${proxyWidth}x${proxyHeight}`,
      )
      .digest("hex");
    await fs.mkdir(this.cacheDir, { recursive: true });
    const file = path.join(this.cacheDir, `${key}.mp4`);
    if (
      !(await fs.access(file).then(
        () => true,
        () => false,
      ))
    ) {
      const temporary = `${file}.${process.pid}.partial.mp4`;
      try {
        await runProcess(
          findBinary("ffmpeg", this.resourcesPath),
          [
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            asset.path,
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            "-vf",
            `scale=${proxyWidth}:${proxyHeight}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "160k",
            "-ar",
            "48000",
            "-ac",
            "2",
            "-movflags",
            "+faststart",
            temporary,
          ],
          { signal: this.abort.signal, timeout: 30 * 60 * 1000 },
        );
        await fs.rename(temporary, file);
      } finally {
        await fs.rm(temporary, { force: true });
      }
    }
    if (this.known.get(asset.id) !== fingerprint) return file;
    const existing = this.ready.get(asset.id);
    if (existing === file) return file;
    this.ready.set(asset.id, file);
    this.onReady(asset.id);
    return file;
  }
}
