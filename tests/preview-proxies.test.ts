import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  needsPreviewProxy,
  PreviewProxyService,
  prunePreviewProxyCache,
  removeLegacyPreviewProxies,
} from "../electron/preview-proxies";
import { runProcess } from "../electron/process";
import type { Asset } from "../shared/model";
import { mediaAssetUrl } from "../shared/media-url";

vi.mock("../electron/process", () => ({
  findBinary: () => "ffmpeg",
  runProcess: vi.fn(),
}));

afterEach(() => vi.restoreAllMocks());

const video: Asset = {
  id: "large-video",
  name: "large.mp4",
  path: "large.mp4",
  kind: "video",
  duration: 10,
  width: 2370,
  height: 1560,
  hasAudio: true,
};

it("只为高分辨率且可安全代理的视频请求预览文件", () => {
  expect(needsPreviewProxy(video)).toBe(true);
  expect(needsPreviewProxy({ ...video, width: 1280, height: 720 })).toBe(false);
  expect(needsPreviewProxy({ ...video, path: "large.webm" })).toBe(false);
  expect(needsPreviewProxy({ ...video, kind: "image" })).toBe(false);
});

it("同一素材并发登记只生成一次，生成完成后报告当前代理", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "troncut-proxy-"));
  const source = path.join(root, "large.mp4");
  await fs.writeFile(source, "source");
  let complete!: (id: string) => void;
  const ready = new Promise<string>((resolve) => {
    complete = resolve;
  });
  vi.mocked(runProcess).mockImplementation(async (_binary, args) => {
    const target = args.at(-1)!;
    await fs.writeFile(target, "proxy");
    return "";
  });
  const service = new PreviewProxyService(
    path.join(root, "cache"),
    undefined,
    complete,
  );
  const asset = { ...video, path: source };
  service.request(asset);
  service.request(asset);

  await expect(ready).resolves.toBe(asset.id);
  expect(vi.mocked(runProcess)).toHaveBeenCalledTimes(1);
  const args = vi.mocked(runProcess).mock.calls[0][1];
  expect(args.slice(args.indexOf("-g"), args.indexOf("-g") + 2)).toEqual(["-g", "15"]);
  expect(args.slice(args.lastIndexOf("-threads"), args.lastIndexOf("-threads") + 2)).toEqual(["-threads", "2"]);
  expect(service.path(asset.id)).toMatch(/\.mp4$/);
  expect(await fs.readFile(service.path(asset.id)!, "utf8")).toBe("proxy");
  await fs.rm(root, { recursive: true, force: true });
});

it("预览 URL 带独立版本参数，原片 URL 保持兼容", () => {
  expect(mediaAssetUrl("clip")).toBe("framecraft-media://asset/clip");
  expect(mediaAssetUrl("clip", true, 2)).toBe(
    "framecraft-media://asset/clip?preview=1&revision=2",
  );
});

it("旧版应用数据目录只清理生成的代理文件", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "troncut-proxy-clean-"));
  try {
    const key = "a".repeat(64);
    for (const name of [`${key}.mp4`, `${key}.webm.123.partial.webm`, "notes.mp4"])
      await fs.writeFile(path.join(root, name), name);
    await removeLegacyPreviewProxies(root);
    expect(await fs.readdir(root)).toEqual(["notes.mp4"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

it("保存项目后只清理不再使用的代理，保留同源素材共用的缓存和其他文件", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "troncut-proxy-prune-"));
  try {
    const sourceA = path.join(root, "a.mp4");
    const sourceB = path.join(root, "b.mp4");
    await fs.writeFile(sourceA, "a");
    await fs.writeFile(sourceB, "b");
    const cache = path.join(root, "cache");
    const assets = [
      { ...video, id: "a1", path: sourceA },
      { ...video, id: "a2", path: sourceA },
      { ...video, id: "b", path: sourceB },
    ];
    vi.mocked(runProcess).mockImplementation(async (_binary, args) => {
      await fs.writeFile(args.at(-1)!, "proxy");
      return "";
    });
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => { resolveReady = resolve; });
    let count = 0;
    const service = new PreviewProxyService(cache, undefined, () => {
      if (++count === assets.length) resolveReady();
    });
    assets.forEach((asset) => service.request(asset));
    await ready;
    const shared = path.basename(service.path("a1")!);
    const removed = path.basename(service.path("b")!);
    expect(service.path("a2")).toBe(service.path("a1"));
    await fs.writeFile(path.join(cache, "notes.txt"), "keep");
    await fs.writeFile(path.join(cache, `${shared}.123.partial.mp4`), "partial");
    service.dispose();
    await service.waitForIdle();
    expect((await prunePreviewProxyCache(cache, [assets[1]])).sort()).toEqual(
      [removed, `${shared}.123.partial.mp4`].sort(),
    );
    expect(await fs.readdir(cache)).toEqual([shared, "notes.txt"].sort());
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
