import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import {
  ClonedVoices,
  validateVoiceReference,
} from "../electron/cloned-voices";
import { runProcess } from "../electron/process";
import { probeMedia } from "../electron/media";
import { ttsOptionsSchema } from "../shared/tts";
import { narrationSchema } from "../shared/cli";

vi.mock("../electron/process", () => ({
  findBinary: (name: string) => name,
  runProcess: vi.fn(),
}));
vi.mock("../electron/media", () => ({ probeMedia: vi.fn() }));
vi.mock("../electron/onnx-session", async () => ({
  runOnnxSession: (await import("../electron/process")).runProcess,
}));

beforeEach(() => vi.resetAllMocks());

async function setup() {
  const root = await fs.mkdtemp(path.resolve("test-output/cloned-voices-"));
  const source = path.join(root, "原始参考.wav");
  await fs.writeFile(source, "original");
  const asset = {
    id: randomUUID(),
    path: source,
    name: "参考声音",
    kind: "audio" as const,
    duration: 5,
    hasAudio: true,
    width: 0,
    height: 0,
  };
  vi.mocked(probeMedia).mockResolvedValue(asset);
  vi.mocked(runProcess).mockImplementation(async (_binary, args) => {
    if (args.includes("--request")) {
      const request = JSON.parse(
        await fs.readFile(args[args.indexOf("--request") + 1], "utf8"),
      );
      expect(request.transcript).toBe("这是参考声音。");
      expect(request.engine).toBe("lux-onnx");
      await fs.writeFile(args.at(-1)!, "encoded prompt");
    } else {
      await fs.writeFile(args.at(-1)!, "normalized reference");
    }
    return "";
  });
  return {
    root,
    source,
    asset,
    store: new ClonedVoices(root),
    paths: {
      userData: root,
      workers: path.resolve("workers/onnx"),
      resources: "",
    },
    input: {
      name: "我的音色",
      referenceAssetId: asset.id,
      transcript: "这是参考声音。",
    },
  };
}

it("克隆音色包含独立音频和编码，重开可读取，删除不影响用户原文件", async () => {
  const { root, source, asset, store, paths, input } = await setup();
  const voice = await store.create(
    input,
    asset,
    paths,
    new AbortController().signal,
    () => {},
  );
  const reopened = new ClonedVoices(root);
  expect(await reopened.list()).toEqual([voice]);
  const saved = await reopened.get(voice.id);
  expect(await fs.readFile(saved.reference, "utf8")).toBe(
    "normalized reference",
  );
  expect(await fs.readFile(saved.prompt, "utf8")).toBe("encoded prompt");
  expect(await fs.readdir(path.dirname(saved.prompt))).toEqual([
    "prompt.npz",
    "reference.wav",
    "voice.json",
  ]);
  await reopened.remove(voice.id);
  expect(await fs.readFile(source, "utf8")).toBe("original");
  expect(await reopened.list()).toEqual([]);
  await expect(reopened.get(voice.id)).rejects.toThrow("已删除");
});

it("失败及取消不会留下一半音色，拒绝无效区间、文字和越界 ID", async () => {
  const { asset, store, paths, input } = await setup();
  expect(() => validateVoiceReference({ ...asset, duration: 2 })).toThrow(
    "3–30",
  );
  expect(() => validateVoiceReference({ ...asset, duration: 31 })).toThrow(
    "3–30",
  );
  await expect(store.get("../escape")).rejects.toThrow();
  await expect(store.remove("../escape")).rejects.toThrow();
  await expect(
    store.create(
      { ...input, transcript: " " },
      asset,
      paths,
      new AbortController().signal,
      () => {},
    ),
  ).rejects.toThrow();
  vi.mocked(runProcess).mockRejectedValueOnce(new Error("任务已取消"));
  await expect(
    store.create(input, asset, paths, new AbortController().signal, () => {}),
  ).rejects.toThrow("已取消");
  expect(await store.list()).toEqual([]);
  expect(await fs.readdir(path.join(paths.userData, "cloned-voices"))).toEqual(
    [],
  );
});

it("LuxTTS 接受本机克隆音色，GUI 和 CLI 拒绝空音色及错误设备", () => {
  const voice = randomUUID();
  expect(
    ttsOptionsSchema.parse({ engine: "lux-onnx", voice, text: "测试" }).voice,
  ).toBe(voice);
  expect(
    ttsOptionsSchema.safeParse({
      engine: "lux-onnx",
      voice: "10",
      text: "测试",
    }).success,
  ).toBe(false);
  expect(
    ttsOptionsSchema.safeParse({
      engine: "lux-onnx",
      voice,
      text: "测试",
      device: "cuda",
    }).success,
  ).toBe(false);
  expect(
    narrationSchema.safeParse({
      engine: "lux-onnx",
      segments: [{ start: 0, end: 3, text: "测试" }],
    }).success,
  ).toBe(false);
  expect(
    narrationSchema.parse({
      engine: "lux-onnx",
      voice,
      segments: [{ start: 0, end: 3, text: "测试" }],
    }).voice,
  ).toBe(voice);
});
