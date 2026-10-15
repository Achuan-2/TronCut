import fs from "node:fs/promises";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { SpeechVoicePreviews } from "../electron/speech-preview";
import { synthesizeSpeech } from "../electron/synthesis";

vi.mock("../electron/synthesis", () => ({ synthesizeSpeech: vi.fn() }));

it("音色试听使用独立示例，并只清理自己生成的临时目录", async () => {
  const root = path.resolve(`test-output/speech-preview-${Date.now()}`);
  const folder = path.join(root, "narration/speech-preview");
  const formal = path.join(root, "narration/speech-formal");
  await fs.mkdir(folder, { recursive: true });
  await fs.mkdir(formal, { recursive: true });
  await fs.writeFile(path.join(folder, "narration.wav"), "preview");
  await fs.writeFile(path.join(formal, "narration.wav"), "formal");
  const asset = {
    id: "preview",
    name: "preview",
    path: path.join(folder, "narration.wav"),
    kind: "audio" as const,
    duration: 2,
    width: 0,
    height: 0,
    hasAudio: true,
  };
  vi.mocked(synthesizeSpeech).mockResolvedValueOnce(asset);
  const store = new SpeechVoicePreviews();
  const signal = new AbortController().signal;
  expect(
    await store.create(
      { engine: "windows-sapi", voice: "auto", text: "用户尚未完成的旁白文稿" },
      { userData: root, workers: "", resources: "" },
      signal,
      () => {},
    ),
  ).toBe(asset);
  expect(vi.mocked(synthesizeSpeech).mock.calls.at(-1)![0].text).toContain(
    "当前音色的试听",
  );
  expect(vi.mocked(synthesizeSpeech).mock.calls.at(-1)![2]).toBe(signal);
  expect(await store.release("formal")).toBeUndefined();
  expect(await store.release("preview")).toBe(asset);
  await expect(fs.access(folder)).rejects.toThrow();
  expect(await fs.readFile(path.join(formal, "narration.wav"), "utf8")).toBe(
    "formal",
  );
  expect(await store.release("preview")).toBeUndefined();
});

it("拒绝把外部素材当作可删除的试听文件", async () => {
  const root = path.resolve(
    `test-output/speech-preview-boundary-${Date.now()}`,
  );
  await fs.mkdir(root, { recursive: true });
  const file = path.join(root, "user.wav");
  await fs.writeFile(file, "user");
  vi.mocked(synthesizeSpeech).mockResolvedValueOnce({
    id: "user",
    name: "user",
    path: file,
    kind: "audio",
    duration: 2,
    width: 0,
    height: 0,
    hasAudio: true,
  });
  const store = new SpeechVoicePreviews();
  await expect(
    store.create(
      { engine: "windows-sapi", voice: "auto", text: "试听" },
      { userData: root, workers: "", resources: "" },
      new AbortController().signal,
      () => {},
    ),
  ).rejects.toThrow("临时配音目录");
  await store.release("user");
  expect(await fs.readFile(file, "utf8")).toBe("user");
});
