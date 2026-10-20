import { expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createProject, newText } from "../shared/model";
import { setFrameExtension } from "../shared/frame-extension";
import { exportFrame, exportVideo } from "../electron/export";
import { saveProject, openProject } from "../electron/project-store";
import { renderTimelineAudio } from "../electron/timeline-audio";
import { probeMedia } from "../electron/media";
import { findBinary, runProcess } from "../electron/process";

it("实际导出在扩展区间保持同一视频帧并静音，结束后恢复原画面和音频", async () => {
  const root = path.resolve(
    `test-output/frame-extension-export/run-${Date.now()}`,
  );
  await fs.mkdir(root, { recursive: true });
  const source = path.join(root, "source.mp4");
  const ffmpeg = findBinary("ffmpeg");
  const signal = new AbortController().signal;
  await runProcess(ffmpeg, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=160x90:r=20:d=3",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=3",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    source,
  ]);
  const project = createProject("帧定格导出");
  project.canvas = { width: 160, height: 90, fps: 20, background: "#000000" };
  project.exportSettings = { encoder: "software" };
  const asset = await probeMedia(source);
  project.assets = [asset];
  project.clips = [
    {
      ...newText("video", 0),
      id: "video",
      kind: "video",
      assetId: asset.id,
      duration: 3,
    },
  ];
  const extended = setFrameExtension(project, "video", 1, 1.5);
  const file = path.join(root, "project", "extension.troncut");
  await saveProject(extended, file);
  const reopened = await openProject(file);
  expect(reopened.clips[0].stitch).toEqual(extended.clips[0].stitch);
  const target = path.join(root, "extended.mp4");
  await exportVideo(
    reopened,
    target,
    path.join(root, "work"),
    false,
    signal,
    () => {},
  );
  expect((await probeMedia(target)).duration).toBeCloseTo(4.5, 1);
  const frame = async (input: string, time: number, name: string) => {
    const image = path.join(root, `${name}.png`);
    await runProcess(ffmpeg, [
      "-y",
      "-ss",
      String(time),
      "-i",
      input,
      "-frames:v",
      "1",
      image,
    ]);
    return sharp(image).removeAlpha().raw().toBuffer();
  };
  const first = await frame(target, 1.2, "frozen-first");
  const last = await frame(target, 2.3, "frozen-last");
  const difference = (a: Buffer, b: Buffer) =>
    a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0) / a.length;
  expect(difference(first, last)).toBeLessThan(1);
  const original = await frame(source, 1, "source-freeze");
  expect(difference(first, original)).toBeLessThan(7);
  const resumed = await frame(target, 3, "resumed");
  const expected = await frame(source, 1.5, "source-resumed");
  expect(difference(resumed, expected)).toBeLessThan(7);
  expect(difference(first, resumed)).toBeGreaterThan(8);
  const capture = path.join(root, "snapshot.png");
  await exportFrame(reopened, 2, capture, path.join(root, "capture"), signal);
  expect(
    difference(await sharp(capture).removeAlpha().raw().toBuffer(), original),
  ).toBeLessThan(5);
  const audio = path.join(root, "timeline.wav");
  await renderTimelineAudio(
    reopened,
    audio,
    path.join(root, "audio-work"),
    signal,
  );
  for (const input of [target, audio]) {
    for (const [time, silent] of [
      [0.3, false],
      [1.2, true],
      [2.2, true],
      [2.8, false],
    ] as const) {
      const raw = path.join(root, `${path.basename(input)}-${time}.f32`);
      await runProcess(ffmpeg, [
        "-y",
        "-ss",
        String(time),
        "-i",
        input,
        "-t",
        "0.15",
        "-vn",
        "-ac",
        "1",
        "-ar",
        "48000",
        "-f",
        "f32le",
        raw,
      ]);
      const samples = await fs.readFile(raw);
      let square = 0;
      for (let i = 0; i < samples.length; i += 4)
        square += samples.readFloatLE(i) ** 2;
      const rms = Math.sqrt(square / (samples.length / 4));
      if (silent) expect(rms).toBeLessThan(0.002);
      else expect(rms).toBeGreaterThan(0.04);
    }
  }
}, 120000);
