import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  needsPreviewProxy,
  PreviewProxyService,
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
