import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  readBuffer: vi.fn(),
  readImage: vi.fn(),
  writeBuffer: vi.fn(),
  runProcess: vi.fn(),
  probeMedia: vi.fn(),
}));
vi.mock("electron", () => ({ clipboard: mocks }));
vi.mock("../electron/process", () => ({ runProcess: mocks.runProcess }));
vi.mock("../electron/media", () => ({ probeMedia: mocks.probeMedia }));
import {
  copyClipClipboard,
  importClipboardMedia,
} from "../electron/clipboard-media";

describe("粘贴媒体与内部片段剪贴板", () => {
  let storage: string;
  beforeEach(async () => {
    vi.resetAllMocks();
    storage = await fs.mkdtemp(path.join(os.tmpdir(), "troncut-clipboard-"));
    mocks.readBuffer.mockReturnValue(Buffer.alloc(0));
    mocks.readImage.mockReturnValue({ isEmpty: () => true });
    mocks.runProcess.mockResolvedValue("[]");
    mocks.probeMedia.mockImplementation(async (file: string) => ({
      id: "media",
      path: file,
      kind: file.endsWith(".png") ? "image" : "video",
    }));
  });
  afterEach(async () => {
    await fs.rm(storage, { recursive: true, force: true });
  });
  it("内部片段通过系统标记判断，避免旧片段覆盖新复制的媒体", async () => {
    copyClipClipboard("clip-token");
    expect(mocks.writeBuffer).toHaveBeenCalledWith(
      "TronCut.Clips",
      Buffer.from("clip-token"),
    );
    mocks.readBuffer.mockReturnValue(Buffer.from("clip-token"));
    expect(await importClipboardMedia(storage)).toEqual({
      assets: [],
      clipToken: "clip-token",
    });
    expect(mocks.runProcess).not.toHaveBeenCalled();
  });
  it("截图保存为持久化 PNG，后续保存工程和恢复可读取", async () => {
    const png = Buffer.from([137, 80, 78, 71]);
    mocks.readImage.mockReturnValue({ isEmpty: () => false, toPNG: () => png });
    const result = await importClipboardMedia(storage);
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].path).toMatch(/粘贴图片-.*\.png$/);
    expect(await fs.readFile(result.assets[0].path)).toEqual(png);
    expect(result.clipToken).toBeNull();
  });
  it.skipIf(process.platform !== "win32")(
    "读取多选图片和视频文件，保留中文路径并过滤无关文件",
    async () => {
      mocks.runProcess.mockResolvedValue(
        JSON.stringify([
          "D:\\素材\\图片.PNG",
          "D:\\素材\\视频.mp4",
          "D:\\素材\\图片.PNG",
          "D:\\素材\\说明.txt",
        ]),
      );
      const result = await importClipboardMedia(storage);
      expect(result.assets.map((asset) => asset.path)).toEqual([
        "D:\\素材\\图片.PNG",
        "D:\\素材\\视频.mp4",
      ]);
      expect(mocks.readImage).not.toHaveBeenCalled();
      const [binary, args, options] = mocks.runProcess.mock.calls[0];
      expect(binary).toMatch(/powershell\.exe$/);
      expect(args).toContain("-STA");
      expect(options.timeout).toBe(10000);
    },
  );
  it("普通文本或空剪贴板不导入素材", async () => {
    expect(await importClipboardMedia(storage)).toEqual({
      assets: [],
      clipToken: null,
    });
    expect(mocks.probeMedia).not.toHaveBeenCalled();
  });
  it("图片解析失败时清理刚创建的文件并返回原始错误", async () => {
    mocks.readImage.mockReturnValue({
      isEmpty: () => false,
      toPNG: () => Buffer.from("broken"),
    });
    mocks.probeMedia.mockRejectedValue(new Error("图片损坏"));
    await expect(importClipboardMedia(storage)).rejects.toThrow("图片损坏");
    expect(await fs.readdir(storage)).toEqual([]);
  });
});
