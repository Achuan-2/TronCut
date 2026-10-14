import { expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createProject, newText } from "../shared/model";
import { setClipSpeed } from "../shared/clip-speed";
import { runProcess, findBinary } from "../electron/process";
import { probeMedia } from "../electron/media";
import { exportVideo } from "../electron/export";
import { saveProject, openProject } from "../electron/project-store";

it("实际保存重开后导出2倍视频：源区间、颜色时间、时长与440Hz音调均保留", async () => {
  const root = path.resolve("test-output/clip-speed");
  await fs.mkdir(root, { recursive: true });
  const source = path.join(root, "source.mp4");
  await runProcess(findBinary("ffmpeg"), [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=80x60:r=10:d=2",
    "-f",
    "lavfi",
    "-i",
    "color=c=lime:s=80x60:r=10:d=2",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=80x60:r=10:d=2",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=6",
    "-filter_complex",
    "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]",
    "-map",
    "[v]",
    "-map",
    "3:a",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    source,
  ]);
  const project = createProject();
  project.canvas = { width: 160, height: 90, fps: 10, background: "#101319" };
  project.exportSettings = { encoder: "software" };
  const asset = await probeMedia(source);
  project.assets = [asset];
  project.clips = [
    setClipSpeed(
      {
        ...newText("video", 0),
        kind: "video",
        assetId: asset.id,
        sourceIn: 1,
        duration: 4,
      },
      2,
    ),
  ];
  const file = path.join(root, "saved", "speed.troncut");
  await saveProject(project, file);
  const reopened = await openProject(file);
  expect(reopened.clips[0]).toMatchObject({
    sourceIn: 1,
    duration: 2,
    speed: 2,
    speedEffect: true,
  });
  const target = path.join(root, "speed.mp4");
  await exportVideo(
    reopened,
    target,
    path.join(root, "work"),
    false,
    new AbortController().signal,
    () => {},
  );
  expect((await probeMedia(target)).duration).toBeCloseTo(2, 1);
  for (const [time, channel] of [
    [0.2, 0],
    [1, 1],
    [1.8, 2],
  ] as const) {
    const png = path.join(root, `${time}.png`);
    await runProcess(findBinary("ffmpeg"), [
      "-y",
      "-ss",
      String(time),
      "-i",
      target,
      "-frames:v",
      "1",
      png,
    ]);
    const pixel = await sharp(png)
      .extract({ left: 80, top: 45, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer();
    expect(pixel[channel]).toBeGreaterThan(230);
  }
  const audio = path.join(root, "audio.f32");
  await runProcess(findBinary("ffmpeg"), [
    "-y",
    "-ss",
    "0.3",
    "-i",
    target,
    "-t",
    "1",
    "-vn",
    "-ac",
    "1",
    "-ar",
    "48000",
    "-f",
    "f32le",
    audio,
  ]);
  const samples = await fs.readFile(audio);
  let crossings = 0;
  for (let i = 4; i < samples.length; i += 4)
    if (samples.readFloatLE(i - 4) <= 0 && samples.readFloatLE(i) > 0)
      crossings++;
  expect(crossings / (samples.length / 4 / 48000)).toBeCloseTo(440, -1);
}, 30000);
