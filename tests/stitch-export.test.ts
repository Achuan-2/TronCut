import { expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createProject, newText } from "../shared/model";
import { stitchClips, unstitchClips } from "../shared/stitch";
import { exportVideo, exportFrame } from "../electron/export";
import { renderTimelineAudio } from "../electron/timeline-audio";
import { saveProject, openProject } from "../electron/project-store";
import { probeMedia } from "../electron/media";
import { findBinary, runProcess } from "../electron/process";
import { setClipSpeed } from "../shared/clip-speed";

it("拼接保存重开与实际导出保留源跳跃、连续动画和音频，移除拼接后画面一致", async () => {
  const root = path.resolve(`test-output/stitch-export/run-${Date.now()}`);
  await fs.mkdir(root, { recursive: true });
  const source = path.join(root, "source.mp4");
  const binary = findBinary("ffmpeg");
  const signal = new AbortController().signal;
  await runProcess(binary, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=80x60:r=20:d=1",
    "-f",
    "lavfi",
    "-i",
    "color=c=lime:s=80x60:r=20:d=1",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=80x60:r=20:d=1",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=1",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=660:sample_rate=48000:duration=1",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=880:sample_rate=48000:duration=1",
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
  ]);
  const project = createProject();
  project.canvas = { width: 160, height: 90, fps: 20, background: "#101319" };
  project.exportSettings = { encoder: "software" };
  const asset = await probeMedia(source);
  project.assets = [asset];
  project.clips = [0, 2].map((sourceIn, index) => ({
    ...newText("video", index),
    kind: "video",
    assetId: asset.id,
    duration: 1,
    sourceIn,
  }));
  const stitched = stitchClips(
    project,
    project.clips.map((clip) => clip.id),
  );
  expect(stitched.clips).toHaveLength(1);
  const clip = stitched.clips[0];
  clip.keyframes = [
    { time: 0, value: { ...clip.transform, x: 0.35, scale: 0.6 } },
    {
      time: 2,
      value: { ...clip.transform, x: 0.65, scale: 1.2 },
      easing: "linear",
    },
  ];
  const file = path.join(root, "saved", "stitch.troncut");
  await saveProject(stitched, file);
  const reopened = await openProject(file);
  expect(reopened.clips[0].stitch).toEqual(clip.stitch);
  const target = path.join(root, "stitched.mp4");
  await exportVideo(
    reopened,
    target,
    path.join(root, "work"),
    false,
    signal,
    () => {},
  );
  expect((await probeMedia(target)).duration).toBeCloseTo(2, 1);
  const pixel = async (input: string, time: number, name: string) => {
    const png = path.join(root, `${name}.png`);
    await runProcess(binary, [
      "-y",
      "-ss",
      String(time),
      "-i",
      input,
      "-frames:v",
      "1",
      png,
    ]);
    return sharp(png)
      .extract({ left: 80, top: 45, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer();
  };
  expect((await pixel(target, 0.4, "red"))[0]).toBeGreaterThan(230);
  expect((await pixel(target, 1.4, "blue"))[2]).toBeGreaterThan(230);
  const capture = path.join(root, "capture.png");
  await exportFrame(
    reopened,
    1.4,
    capture,
    path.join(root, "capture-work"),
    signal,
  );
  expect(
    (
      await sharp(capture)
        .extract({ left: 80, top: 45, width: 1, height: 1 })
        .removeAlpha()
        .raw()
        .toBuffer()
    )[2],
  ).toBeGreaterThan(230);

  const separated = unstitchClips(reopened, [clip.id]);
  const unstitched = path.join(root, "unstitched.mp4");
  await exportVideo(
    separated,
    unstitched,
    path.join(root, "unstitched-work"),
    false,
    signal,
    () => {},
  );
  for (const time of [0.5, 0.95, 1, 1.05, 1.5]) {
    const first = path.join(root, `stitched-${time}.png`);
    const second = path.join(root, `unstitched-${time}.png`);
    await exportFrame(
      reopened,
      time,
      first,
      path.join(root, `first-${time}`),
      signal,
    );
    await exportFrame(
      separated,
      time,
      second,
      path.join(root, `second-${time}`),
      signal,
    );
    expect(await fs.readFile(first)).toEqual(await fs.readFile(second));
  }
  // Verify the audible source jumps from 440 Hz to 880 Hz rather than replaying 660 Hz.
  const audio = path.join(root, "timeline.wav");
  await renderTimelineAudio(
    reopened,
    audio,
    path.join(root, "audio-work"),
    signal,
  );
  for (const input of [target, audio]) {
    for (const [time, frequency] of [
      [0.2, 440],
      [1.2, 880],
    ]) {
      const raw = path.join(root, `audio-${path.basename(input)}-${time}.f32`);
      await runProcess(binary, [
        "-y",
        "-ss",
        String(time),
        "-i",
        input,
        "-t",
        "0.5",
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "f32le",
        raw,
      ]);
      const data = await fs.readFile(raw);
      let crossings = 0;
      for (let offset = 4; offset < data.length; offset += 4)
        if (data.readFloatLE(offset - 4) <= 0 && data.readFloatLE(offset) > 0)
          crossings++;
      expect(crossings / (data.length / 4 / 16000)).toBeCloseTo(frequency, -1);
    }
  }
  const fast = { ...reopened, clips: [setClipSpeed(reopened.clips[0], 2)] };
  const fastTarget = path.join(root, "fast.mp4");
  await exportVideo(
    fast,
    fastTarget,
    path.join(root, "fast-work"),
    false,
    signal,
    () => {},
  );
  expect((await probeMedia(fastTarget)).duration).toBeCloseTo(1, 1);
  expect((await pixel(fastTarget, 0.7, "fast-blue"))[2]).toBeGreaterThan(230);
  // Releasing a stitch must also retain fades spanning an internal seam.
  const faded = {
    ...reopened,
    clips: [{ ...reopened.clips[0], fadeIn: 1.7, fadeOut: 0.2 }],
  };
  const released = unstitchClips(faded, [clip.id]);
  const fadeOutputs: string[] = [];
  for (const [index, version] of [faded, released].entries()) {
    const output = path.join(root, `fade-${index}.mp4`);
    await exportVideo(
      version,
      output,
      path.join(root, `fade-work-${index}`),
      false,
      signal,
      () => {},
    );
    fadeOutputs.push(output);
  }
  for (const time of [0.4, 1.1, 1.5, 1.9]) {
    const before = await pixel(fadeOutputs[0], time, `fade-before-${time}`);
    const after = await pixel(fadeOutputs[1], time, `fade-after-${time}`);
    expect(
      Math.max(...before.map((value, index) => Math.abs(value - after[index]))),
    ).toBeLessThanOrEqual(3);
  }
}, 60000);
