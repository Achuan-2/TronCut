import { expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  createProject,
  defaultTransform,
  validateProject,
  type Clip,
} from "../shared/model";
import { animateContent, animateCrop } from "../shared/crop-animation";
import { defaultCrop } from "../shared/effects";
import { probeMedia } from "../electron/media";
import { exportVideo } from "../electron/export";
import { runProcess, findBinary } from "../electron/process";

it("真实视频导出固定范围缩放动画及边缘裁剪，保存重开保留起止、中间帧和背景", async () => {
  const root = path.resolve("test-output/crop-animation");
  await fs.mkdir(root, { recursive: true });
  const png = path.join(root, "source.png"),
    video = path.join(root, "source.mp4");
  await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><path fill="#c80000" d="M0 0H60V80H0Z"/><path fill="#00c800" d="M60 0H120V80H60Z"/></svg>',
    ),
  )
    .png()
    .toFile(png);
  await runProcess(findBinary("ffmpeg"), [
    "-y",
    "-loop",
    "1",
    "-i",
    png,
    "-t",
    "5",
    "-r",
    "10",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    video,
  ]);
  const project = createProject();
  project.canvas = { width: 200, height: 120, fps: 10, background: "#5432b2" };
  project.exportSettings = { encoder: "software" };
  const asset = await probeMedia(video);
  project.assets = [asset];
  const clip: Clip = {
    id: "animation",
    kind: "video",
    assetId: asset.id,
    trackId: "video",
    name: "视频",
    start: 0,
    duration: 5,
    sourceIn: 0,
    speed: 1,
    volume: 1,
    podcast: false,
    transform: { ...defaultTransform, scale: 0.6 },
    keyframes: [],
  };
  const content = animateContent(
    clip,
    { scale: 2, x: 0.2 },
    { time: 2, auto: true },
  );
  const animated = animateCrop(
    content,
    { ...defaultCrop, left: 0.25 },
    { width: 180, height: 120 },
    project.canvas,
    { time: 4, auto: true },
  );
  // Use linear easing so sampled color transitions have a calculable position.
  project.clips = [
    {
      ...animated,
      keyframes: animated.keyframes.map((frame) => ({
        ...frame,
        easing: "linear",
      })),
    },
  ];
  const reopened = validateProject(JSON.parse(JSON.stringify(project))),
    output = path.join(root, "animation.mp4");
  await exportVideo(
    reopened,
    output,
    path.join(root, "render"),
    false,
    new AbortController().signal,
    () => {},
  );
  for (const [time, centerGreen, cropped] of [
    [0.5, true, false],
    [1.5, true, false],
    [2.5, false, false],
    [3.5, false, false],
    [4.5, false, true],
  ] as const) {
    const file = path.join(root, `frame-${time}.png`);
    await runProcess(findBinary("ffmpeg"), [
      "-y",
      "-ss",
      String(time),
      "-i",
      output,
      "-frames:v",
      "1",
      file,
    ]);
    const pixel = async (x: number, y: number) => [
      ...(await sharp(file)
        .extract({ left: x, top: y, width: 1, height: 1 })
        .removeAlpha()
        .raw()
        .toBuffer()),
    ];
    const bg = async (x: number, y: number) => {
      const value = await pixel(x, y);
      [84, 50, 178].forEach((channel, i) =>
        expect(Math.abs(value[i] - channel)).toBeLessThan(14),
      );
    };
    await bg(40, 60);
    await bg(160, 60);
    await bg(100, 15);
    const center = await pixel(115, 60);
    expect(center[centerGreen ? 1 : 0]).toBeGreaterThan(175);
    expect(center[2]).toBeLessThan(30);
    if (cropped) await bg(65, 60);
    else expect((await pixel(65, 60))[0]).toBeGreaterThan(175);
  }
}, 30000);
