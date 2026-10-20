import { expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createProject, newText, validateProject } from "../shared/model";
import { normalizesClip } from "../shared/loudness";
import {
  parseLoudnessMeasurement,
  prepareNormalizedAudio,
  setLoudnessCacheDirectory,
} from "../electron/loudness";
import { findBinary, runProcess } from "../electron/process";
import { probeMedia } from "../electron/media";
import { exportVideo } from "../electron/export";
import { renderTimelineAudio } from "../electron/timeline-audio";
import { groupSelection } from "../shared/timeline";
import {
  createGroupScope,
  projectForGroup,
  mergeGroupProject,
} from "../shared/clip-groups";

const ffmpeg = findBinary("ffmpeg");
async function measure(file: string, start?: number, duration?: number) {
  let output = "";
  await runProcess(
    ffmpeg,
    [
      "-hide_banner",
      "-nostats",
      ...(start === undefined ? [] : ["-ss", String(start)]),
      "-i",
      file,
      ...(duration === undefined ? [] : ["-t", String(duration)]),
      "-vn",
      "-af",
      `${duration === undefined ? "" : `atrim=duration=${duration},`}aformat=channel_layouts=stereo,loudnorm=I=-18:TP=-1.5:LRA=50:print_format=json`,
      "-f",
      "null",
      "-",
    ],
    {
      onStderr: (text) => {
        output += text;
      },
    },
  );
  return parseLoudnessMeasurement(output);
}

it("项目开关、素材例外和拆分音频状态独立保存，旧项目保持原来的声音", () => {
  const project = createProject();
  const clip = {
    ...newText("audio", 0),
    kind: "audio" as const,
    assetId: "source",
  };
  project.assets = [
    {
      id: "source",
      name: "source.wav",
      path: "source.wav",
      kind: "audio",
      width: 0,
      height: 0,
      duration: 10,
      hasAudio: true,
    },
  ];
  expect(normalizesClip(project, clip)).toBe(false);
  project.audio = { autoNormalizeLoudness: true };
  project.clips = [
    clip,
    { ...clip, id: "excluded", autoNormalizeLoudness: false },
  ];
  const saved = validateProject(project);
  expect(normalizesClip(saved, saved.clips[0])).toBe(true);
  expect(normalizesClip(saved, saved.clips[1])).toBe(false);
  expect(normalizesClip(saved, { ...clip, audioDetached: true })).toBe(false);
});

it("静音测量跳过增益，无效或缺失的测量结果明确失败", () => {
  expect(
    parseLoudnessMeasurement('log {"input_i":"-inf","input_tp":"-inf"}'),
  ).toBeNull();
  expect(() => parseLoudnessMeasurement("log")).toThrow("无法读取");
  expect(() =>
    parseLoudnessMeasurement('{"input_i":"-20","input_tp":"NaN"}'),
  ).toThrow("无效");
});

it("在组合中修改项目响度设置会写回完整工程，保留组合外素材", () => {
  let document = createProject();
  document.clips = [
    newText("video", 2),
    newText("audio", 3),
    newText("titles", 10),
  ];
  document = groupSelection(
    document,
    document.clips.slice(0, 2).map((clip) => clip.id),
  );
  const scope = createGroupScope(document, document.clips[0].groupId!)!;
  const group = projectForGroup(document, scope);
  const outside = document.clips[2];
  const updated = mergeGroupProject(document, scope, {
    ...group,
    audio: { autoNormalizeLoudness: true },
  });
  expect(updated.audio?.autoNormalizeLoudness).toBe(true);
  expect(updated.clips.find((clip) => clip.id === outside.id)).toBe(outside);
  expect(document.audio).toBeUndefined();
});

it("真实安静和较响音频统一到目标响度，预览缓存、试听与导出保留音量、时间和素材例外", async () => {
  const root = await fs.mkdtemp(path.resolve("test-output/loudness-"));
  setLoudnessCacheDirectory(path.join(root, "cache"));
  const files = await Promise.all(
    [0.08, 2].map(async (gain, index) => {
      const file = path.join(root, `tone-${index}.wav`);
      await runProcess(ffmpeg, [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000:duration=3",
        "-af",
        `volume=${gain}`,
        "-c:a",
        "pcm_s16le",
        file,
      ]);
      return probeMedia(file);
    }),
  );
  const sourceHash = createHash("sha256")
    .update(await fs.readFile(files[0].path))
    .digest("hex");
  const prepared = await Promise.all(
    files.map((asset) => prepareNormalizedAudio(asset, false)),
  );
  const measurements = [];
  for (const audio of prepared) {
    const level = (await measure(audio.path))!;
    measurements.push(level);
    expect(Math.abs(level.integrated + 18)).toBeLessThan(0.6);
    expect(level.peak).toBeLessThan(-1.1);
    expect((await probeMedia(audio.path)).duration).toBeCloseTo(3, 1);
  }
  expect(prepared[0].path).not.toBe(files[0].path);
  const modified = (await fs.stat(prepared[0].path)).mtimeMs;
  const cached = await Promise.all(
    Array.from({ length: 4 }, () => prepareNormalizedAudio(files[0], false)),
  );
  expect(cached.every((asset) => asset.id === prepared[0].id)).toBe(true);
  expect((await fs.stat(prepared[0].path)).mtimeMs).toBe(modified);
  const podcast = await prepareNormalizedAudio(files[0], true);
  expect(podcast.id).not.toBe(prepared[0].id);
  expect(Math.abs((await measure(podcast.path))!.integrated + 18)).toBeLessThan(
    0.8,
  );
  expect(
    createHash("sha256")
      .update(await fs.readFile(files[0].path))
      .digest("hex"),
  ).toBe(sourceHash);
  const project = createProject("响度导出");
  project.canvas = { ...project.canvas, width: 64, height: 64, fps: 10 };
  project.audio = { autoNormalizeLoudness: true };
  project.assets = files;
  project.clips = files.map((asset, index) => ({
    ...newText("audio", index * 3),
    kind: "audio",
    assetId: asset.id,
    duration: 3,
  }));
  const target = path.join(root, "normalized.mp4");
  await exportVideo(
    project,
    target,
    path.join(root, "export"),
    false,
    new AbortController().signal,
    () => {},
  );
  const levels = await Promise.all(
    [0, 3].map((start) => measure(target, start, 3)),
  );
  expect(Math.abs(levels[0]!.integrated - levels[1]!.integrated)).toBeLessThan(
    0.6,
  );
  expect(Math.abs(levels[0]!.integrated + 18)).toBeLessThan(0.8);
  project.clips[1] = {
    ...project.clips[1],
    assetId: files[0].id,
    autoNormalizeLoudness: false,
    volume: 0.5,
  };
  const timeline = path.join(root, "timeline.wav");
  await renderTimelineAudio(
    project,
    timeline,
    path.join(root, "timeline"),
    new AbortController().signal,
  );
  const quiet = (await measure(timeline, 3, 3))!.integrated;
  expect((await measure(timeline, 0, 3))!.integrated - quiet).toBeGreaterThan(
    15,
  );
  await fs.writeFile(
    path.join(root, "result.json"),
    JSON.stringify(
      {
        normalized: measurements,
        exported: levels,
        excludedTimeline: quiet,
        sourceHash,
      },
      null,
      2,
    ),
  );
}, 60000);

it("视频裁剪变速及帧定格使用同一标准化音轨，定格区间保持静音和时长", async () => {
  const root = await fs.mkdtemp(path.resolve("test-output/loudness-video-"));
  const file = path.join(root, "source.mp4");
  await runProcess(ffmpeg, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=64x64:r=10:d=5",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=5",
    "-af",
    "volume=0.08",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    file,
  ]);
  const asset = await probeMedia(file);
  const project = createProject();
  project.canvas = { ...project.canvas, width: 64, height: 64, fps: 10 };
  project.audio = { autoNormalizeLoudness: true };
  project.assets = [asset];
  project.clips = [
    {
      ...newText("video", 0),
      kind: "video",
      assetId: asset.id,
      sourceIn: 0,
      speed: 2,
      duration: 3,
      stitch: [
        { sourceIn: 1, duration: 2 },
        { sourceIn: 3, duration: 2, freeze: true },
        { sourceIn: 3, duration: 2 },
      ],
    },
  ];
  const target = path.join(root, "video.mp4");
  await exportVideo(
    project,
    target,
    path.join(root, "export"),
    false,
    new AbortController().signal,
    () => {},
  );
  expect((await probeMedia(target)).duration).toBeCloseTo(3, 1);
  expect(
    Math.abs((await measure(target, 0, 0.9))!.integrated + 18),
  ).toBeLessThan(1);
  expect(await measure(target, 1.2, 0.6)).toBeNull();
  expect(
    Math.abs((await measure(target, 2.1, 0.8))!.integrated + 18),
  ).toBeLessThan(1);
  // The non-stitched path seeks into both the picture and processed sound input.
  project.clips[0] = { ...project.clips[0], stitch: undefined, sourceIn: 1, duration: 1.5 };
  const trimmed = path.join(root, "trimmed.mp4");
  await exportVideo(
    project,
    trimmed,
    path.join(root, "trimmed"),
    false,
    new AbortController().signal,
    () => {},
  );
  expect((await probeMedia(trimmed)).duration).toBeCloseTo(1.5, 1);
  expect(Math.abs((await measure(trimmed))!.integrated + 18)).toBeLessThan(1);
}, 60000);

it("真实静音素材保持静音，源文件更新后使用新的处理缓存", async () => {
  const root = await fs.mkdtemp(path.resolve("test-output/loudness-silence-"));
  const file = path.join(root, "silence.wav");
  await runProcess(ffmpeg, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=48000:cl=stereo",
    "-t",
    "1",
    file,
  ]);
  const asset = await probeMedia(file);
  const first = await prepareNormalizedAudio(asset, false);
  expect(await measure(first.path)).toBeNull();
  await runProcess(ffmpeg, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=1000:duration=1",
    file,
  ]);
  const next = await prepareNormalizedAudio(asset, false);
  expect(next.id).not.toBe(first.id);
  expect((await measure(next.path))!.integrated).toBeGreaterThan(-20);
}, 30000);
