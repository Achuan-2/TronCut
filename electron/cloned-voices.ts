import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Asset } from "../shared/model";
import {
  clonedVoiceSchema,
  createClonedVoiceSchema,
  type CreateClonedVoice,
} from "../shared/cloned-voices";
import { onnxWorkerArguments } from "../shared/onnx";
import { findBinary, runProcess } from "./process";
import { probeMedia } from "./media";
import { onnxEnvironment, prepareOnnxWorker, runOnnxWorker } from "./onnx";

export function validateVoiceReference(asset: Asset) {
  if (
    asset.kind !== "audio" ||
    !asset.hasAudio ||
    asset.duration < 3 ||
    asset.duration > 30.1
  )
    throw new Error("请选择或录制 3–30 秒的参考音频");
}

/** A voice owns its normalized source, transcript and encoded prompt independently of projects. */
export class ClonedVoices {
  private root: string;
  constructor(userData: string) {
    this.root = path.join(userData, "cloned-voices");
  }

  private async folder(id: string) {
    z.string().uuid().parse(id);
    const folder = path.join(this.root, id);
    const [root, actual] = await Promise.all([
      fs.realpath(this.root),
      fs.realpath(folder),
    ]);
    if (path.dirname(actual) !== root) throw new Error("克隆音色目录越界");
    return folder;
  }

  async get(id: string) {
    try {
      const folder = await this.folder(id);
      for (const name of ["reference.wav", "prompt.npz", "voice.json"]) {
        const actual = await fs.realpath(path.join(folder, name));
        if (path.dirname(actual) !== (await fs.realpath(folder)))
          throw new Error("克隆音色文件越界");
      }
      const voice = clonedVoiceSchema.parse(
        JSON.parse(await fs.readFile(path.join(folder, "voice.json"), "utf8")),
      );
      if (voice.id !== id) throw new Error("克隆音色信息不匹配");
      return {
        voice,
        prompt: path.join(folder, "prompt.npz"),
        reference: path.join(folder, "reference.wav"),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new Error("克隆音色已删除或缺少文件，请重新创建音色");
      throw error;
    }
  }

  async list() {
    await fs.mkdir(this.root, { recursive: true });
    const entries = await fs.readdir(this.root, { withFileTypes: true });
    const voices = await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isDirectory() &&
            z.string().uuid().safeParse(entry.name).success,
        )
        .map(async (entry) => (await this.get(entry.name)).voice),
    );
    return voices.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async remove(id: string) {
    const folder = await this.folder(id);
    await fs.rm(folder, { recursive: true, force: true });
  }

  async create(
    input: CreateClonedVoice,
    reference: Asset,
    paths: { userData: string; workers: string; resources: string },
    signal: AbortSignal,
    progress: (percent: number, label: string) => void,
  ) {
    const options = createClonedVoiceSchema.parse(input);
    if (options.referenceAssetId !== reference.id)
      throw new Error("参考音频不匹配");
    validateVoiceReference(reference);
    if (signal.aborted) throw new Error("音色创建已取消");
    await fs.mkdir(this.root, { recursive: true });
    const staging = await fs.mkdtemp(path.join(this.root, ".create-"));
    try {
      progress(0, "正在整理参考音频");
      const audio = path.join(staging, "reference.wav");
      await runProcess(
        findBinary("ffmpeg", paths.resources),
        [
          "-y",
          "-i",
          reference.path,
          "-vn",
          "-ar",
          "24000",
          "-ac",
          "1",
          "-c:a",
          "pcm_s16le",
          audio,
        ],
        { signal },
      );
      const normalized = await probeMedia(audio, paths.resources);
      validateVoiceReference(normalized);
      const workers = await prepareOnnxWorker(paths.workers, paths.userData);
      const request = path.join(staging, "request.json");
      await fs.writeFile(
        request,
        JSON.stringify({
          engine: "lux-onnx",
          input: audio,
          transcript: options.transcript,
          offline: options.offline,
        }),
        "utf8",
      );
      await runOnnxWorker(
        findBinary("uv", paths.resources),
        onnxWorkerArguments(
          workers,
          "clone.py",
          request,
          path.join(staging, "prompt.npz"),
          options.offline,
        ),
        {
          signal,
          cwd: workers,
          env: await onnxEnvironment(paths.userData, workers),
          onLine(line) {
            if (!line.startsWith("TRONCUT_PROGRESS ")) return;
            try {
              const event = z
                .object({
                  percent: z.number().min(0).max(100),
                  label: z.string().max(5000),
                })
                .parse(JSON.parse(line.slice(17)));
              progress(event.percent, event.label);
            } catch {
              /* Ordinary native-library logs. */
            }
          },
        },
        true,
      );
      if (signal.aborted) throw new Error("音色创建已取消");
      const prompt = await fs.stat(path.join(staging, "prompt.npz"));
      if (!prompt.isFile() || !prompt.size)
        throw new Error("没有生成有效的克隆音色");
      const voice = clonedVoiceSchema.parse({
        id: randomUUID(),
        engine: "lux-onnx",
        name: options.name,
        transcript: options.transcript,
        duration: normalized.duration,
        createdAt: new Date().toISOString(),
      });
      await fs.writeFile(
        path.join(staging, "voice.json"),
        JSON.stringify(voice, null, 2),
        "utf8",
      );
      await fs.rm(request, { force: true });
      if (signal.aborted) throw new Error("音色创建已取消");
      await fs.rename(staging, path.join(this.root, voice.id));
      progress(100, "克隆音色已保存");
      return voice;
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
  }
}
