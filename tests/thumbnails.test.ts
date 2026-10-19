import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { mediaThumbnail, mediaWaveform } from "../electron/thumbnails";
import { ThumbnailMemoryCache } from "../electron/thumbnail-cache";
import { runProcess } from "../electron/process";
import type { Asset } from "../shared/model";

vi.mock("../electron/process", () => ({
  findBinary: () => "ffmpeg",
  runProcess: vi.fn(),
}));
afterEach(() => vi.restoreAllMocks());

it("缩略图预算和条目上限按 LRU 淘汰，超大结果不挤掉已有缓存", () => {
  const cache = new ThumbnailMemoryCache(16, 2);
  cache.set("a", "aaa");
  cache.set("b", "bbb");
  expect(cache.get("a")).toBe("aaa");
  cache.set("c", "ccc");
  expect(cache.get("b")).toBeUndefined();
  cache.set("large", "x".repeat(100));
  expect(cache.get("a")).toBe("aaa");
  cache.set("a", "a");
  cache.set("d", "d");
  expect(cache.get("c")).toBeUndefined();
  expect(cache.get("a")).toBe("a");
});

it("同素材并发只解码一次，重复读取命中内存；文件改变后重新生成", async () => {
  const root = path.resolve(`test-output/thumbnails-${Date.now()}`);
  await fs.mkdir(root, { recursive: true });
  const source = path.join(root, "media.mp4");
  await fs.writeFile(source, "first");
  const asset: Asset = {
    id: "thumbnail",
    path: source,
    name: "测试",
    kind: "video",
    duration: 3,
    width: 320,
    height: 180,
    hasAudio: true,
  };
  const processMock = vi
    .mocked(runProcess)
    .mockImplementation(async (_binary, args) => {
      await fs.writeFile(args.at(-1)!, "png");
      return "";
    });
  processMock.mockClear();
  const read = vi.spyOn(fs, "readFile");
  const values = await Promise.all(
    Array.from({ length: 16 }, () => mediaThumbnail(asset, false, root)),
  );
  expect(new Set(values).size).toBe(1);
  expect(processMock).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledTimes(1);
  await Promise.all(
    Array.from({ length: 16 }, () => mediaThumbnail(asset, false, root)),
  );
  expect(read).toHaveBeenCalledTimes(1);
  await fs.writeFile(source, "a changed file");
  await mediaThumbnail(asset, false, root);
  expect(processMock).toHaveBeenCalledTimes(2);
  expect(read).toHaveBeenCalledTimes(2);
  await mediaThumbnail(asset, true, root);
  expect(processMock).toHaveBeenCalledTimes(3);
});

it("解码失败不缓存错误，下一次请求能够重试", async () => {
  const root = path.resolve(`test-output/thumbnails-retry-${Date.now()}`);
  await fs.mkdir(root, { recursive: true });
  const source = path.join(root, "source.mp4");
  await fs.writeFile(source, "video");
  const asset: Asset = {
    id: "retry",
    path: source,
    name: "retry",
    kind: "video",
    duration: 3,
    width: 320,
    height: 180,
    hasAudio: false,
  };
  vi.mocked(runProcess).mockRejectedValueOnce(new Error("decode failed"));
  await expect(mediaThumbnail(asset, false, root)).rejects.toThrow(
    "decode failed",
  );
  vi.mocked(runProcess).mockImplementationOnce(async (_binary, args) => {
    await fs.writeFile(args.at(-1)!, "png");
    return "";
  });
  await expect(mediaThumbnail(asset, false, root)).resolves.toBe(
    "data:image/png;base64,cG5n",
  );
});

it("波形并发请求共享解码，后续命中磁盘，源文件变化时失效", async () => {
  const root = await fs.mkdtemp(path.resolve("test-output/waveform-cache-"));
  const source = path.join(root, "source.wav");
  await fs.writeFile(source, "audio");
  const asset: Asset = {
    id: "waveform",
    path: source,
    name: "波形",
    kind: "audio",
    duration: 1,
    width: 0,
    height: 0,
    hasAudio: true,
  };
  const pcm = Buffer.alloc(24);
  pcm.writeFloatLE(-0.25, 0);
  const processMock = vi
    .mocked(runProcess)
    .mockImplementation(async (_binary, _args, options) => {
      options?.onStdout?.(pcm);
      return "";
    });
  processMock.mockClear();
  const results = await Promise.all(
    Array.from({ length: 12 }, () => mediaWaveform(asset, root)),
  );
  expect(results.every((data) => data?.peaks[0] === 128)).toBe(true);
  expect(processMock).toHaveBeenCalledTimes(1);
  expect((await mediaWaveform(asset, root))?.peaks[0]).toBe(128);
  expect(processMock).toHaveBeenCalledTimes(1);
  await fs.writeFile(source, "changed audio");
  await mediaWaveform(asset, root);
  expect(processMock).toHaveBeenCalledTimes(2);
});

it("失败波形不留缓存，损坏缓存和再次请求能重新生成", async () => {
  const root = await fs.mkdtemp(path.resolve("test-output/waveform-retry-"));
  const source = path.join(root, "source.wav");
  await fs.writeFile(source, "audio");
  const asset: Asset = {
    id: "waveform-retry",
    path: source,
    name: "波形",
    kind: "audio",
    duration: 1,
    width: 0,
    height: 0,
    hasAudio: true,
  };
  const processMock = vi.mocked(runProcess);
  processMock.mockClear();
  processMock.mockRejectedValueOnce(new Error("decode failed"));
  await expect(mediaWaveform(asset, root)).rejects.toThrow("decode failed");
  expect(
    (await fs.readdir(root)).filter((file) => file.endsWith(".waveform")),
  ).toEqual([]);
  processMock.mockImplementation(async (_binary, _args, options) => {
    options?.onStdout?.(Buffer.alloc(24));
    return "";
  });
  expect((await mediaWaveform(asset, root))?.peaks).toEqual(
    new Uint8Array([0]),
  );
  const cached = (await fs.readdir(root)).find((file) =>
    file.endsWith(".waveform"),
  )!;
  await fs.writeFile(path.join(root, cached), Buffer.alloc(8, 255));
  expect((await mediaWaveform(asset, root))?.peaks).toEqual(
    new Uint8Array([0]),
  );
  expect(processMock).toHaveBeenCalledTimes(3);
});
