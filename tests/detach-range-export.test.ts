import { expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createProject, newText } from "../shared/model";
import { detachVideoAudio } from "../shared/detach-audio";
import { deleteTimelineRange } from "../shared/timeline-range";
import { exportVideo } from "../electron/export";
import { renderTimelineAudio } from "../electron/timeline-audio";
import { probeMedia } from "../electron/media";
import { findBinary, runProcess } from "../electron/process";
import { openProject, saveProject } from "../electron/project-store";

it("拆分和范围波纹删除保存重开后音画同步，实际混音和视频导出没有双重声音", async () => {
  const root = path.resolve(
    `test-output/detach-range-export/run-${Date.now()}`,
  );
  await fs.mkdir(root, { recursive: true });
  const ffmpeg = findBinary("ffmpeg");
  const source = path.join(root, "source.mp4");
  const args = ["-y"];
  for (const [color, duration] of [
    ["red", 1],
    ["lime", 1],
    ["blue", 2],
  ])
    args.push(
      "-f",
      "lavfi",
      "-i",
      `color=c=${color}:s=80x60:r=20:d=${duration}`,
    );
  for (const [frequency, duration] of [
    [440, 1],
    [660, 1],
    [880, 2],
  ])
    args.push(
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${frequency}:sample_rate=48000:duration=${duration}`,
    );
  args.push(
    "-filter_complex",
    "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v];[3:a][4:a][5:a]concat=n=3:v=0:a=1[a]",
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    source,
  );
  await runProcess(ffmpeg, args);
  const project = createProject();
  project.canvas = { width: 160, height: 90, fps: 20, background: "#101319" };
  project.exportSettings = { encoder: "software" };
  project.assets = [await probeMedia(source)];
  project.clips = [
    {
      ...newText("video", 0),
      kind: "video",
      assetId: project.assets[0].id,
      duration: 3,
      volume: 0.6,
    },
  ];
  const original = deleteTimelineRange(project, { start: 1, end: 2 }, true);
  const detached = deleteTimelineRange(
    detachVideoAudio(project, [project.clips[0].id]),
    { start: 1, end: 2 },
    true,
  );
  const file = path.join(root, "saved", "edit.troncut");
  await saveProject(detached, file);
  const reopened = await openProject(file);
  expect(
    reopened.clips
      .filter((clip) => clip.kind === "video")
      .every((clip) => clip.audioDetached),
  ).toBe(true);
  expect(
    reopened.clips
      .filter((clip) => clip.kind === "audio")
      .map((clip) => [clip.start, clip.duration, clip.sourceIn]),
  ).toEqual([
    [0, 1, 0],
    [1, 1, 2],
  ]);
  const signal = new AbortController().signal;
  const before = path.join(root, "before.wav"),
    after = path.join(root, "after.wav");
  await renderTimelineAudio(
    original,
    before,
    path.join(root, "mix-before"),
    signal,
  );
  await renderTimelineAudio(
    reopened,
    after,
    path.join(root, "mix-after"),
    signal,
  );
  expect(await fs.readFile(after)).toEqual(await fs.readFile(before));
  const target = path.join(root, "edited.mp4");
  const referenceVideo = path.join(root, "reference.mp4");
  await exportVideo(
    original,
    referenceVideo,
    path.join(root, "reference-export"),
    false,
    signal,
    () => {},
  );
  await exportVideo(
    reopened,
    target,
    path.join(root, "export"),
    false,
    signal,
    () => {},
  );
  expect((await probeMedia(target)).duration).toBeCloseTo(2, 1);
  const frame = path.join(root, "blue.png");
  await runProcess(ffmpeg, [
    "-y",
    "-ss",
    "1.4",
    "-i",
    target,
    "-frames:v",
    "1",
    frame,
  ]);
  const pixel = await sharp(frame)
    .extract({ left: 80, top: 45, width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer();
  expect(pixel[2]).toBeGreaterThan(220);
  const amplitudes: number[] = [];
  for (const [name, input] of [
    ["reference", referenceVideo],
    ["export", target],
  ]) {
    const raw = path.join(root, `${name}.f32`);
    await runProcess(ffmpeg, [
      "-y",
      "-i",
      input,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "f32le",
      raw,
    ]);
    const bytes = await fs.readFile(raw);
    let square = 0;
    for (let i = 3200; i < 11200; i++) square += bytes.readFloatLE(i * 4) ** 2;
    amplitudes.push(Math.sqrt(square / 8000));
  }
  expect(amplitudes[1] / amplitudes[0]).toBeGreaterThan(0.9);
  expect(amplitudes[1] / amplitudes[0]).toBeLessThan(1.1);
}, 30000);
