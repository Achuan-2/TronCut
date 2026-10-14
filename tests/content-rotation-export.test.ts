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
import { projectDelta } from "../shared/rotation";
import { exportVideo } from "../electron/export";
import { probeMedia } from "../electron/media";
import { findBinary, runProcess } from "../electron/process";

it("真实视频框内缩放/平移保留背景，三轴旋转与关键帧输出匹配预览投影", async () => {
  const root = path.resolve("test-output/content-rotation");
  await fs.mkdir(root, { recursive: true });
  const png = path.join(root, "source.png"),
    video = path.join(root, "source.mp4");
  await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><path fill="#c80000" d="M0 0H50V80H0Z"/><path fill="#00c800" d="M50 0H100V80H50Z"/></svg>',
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
    "0.4",
    "-r",
    "10",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    video,
  ]);
  const project = createProject();
  project.canvas = { width: 160, height: 120, fps: 10, background: "#5432b2" };
  project.exportSettings = { encoder: "software" };
  const asset = await probeMedia(video);
  project.assets = [asset];
  const base: Clip = {
    id: "base",
    kind: "video",
    assetId: asset.id,
    trackId: "video",
    name: "视频",
    start: 0,
    duration: 0.4,
    sourceIn: 0,
    speed: 1,
    volume: 1,
    podcast: false,
    transform: { ...defaultTransform, scale: 0.6 },
    keyframes: [],
  };
  const states: Partial<Clip>[] = [
    { contentTransform: { scale: 2, x: 0, y: 0 } },
    { contentTransform: { scale: 2, x: 0.5, y: 0 } },
    { contentTransform: { scale: 0.5, x: 0.2, y: 0 } },
    { transform: { ...base.transform, rotationX: 60 } },
    { transform: { ...base.transform, rotationY: 60 } },
    {
      transform: {
        ...base.transform,
        rotationX: 45,
        rotationY: 40,
        rotation: 30,
      },
    },
    { transform: { ...base.transform, rotationY: 90 } },
    {
      keyframes: [
        { time: 0, value: base.transform },
        {
          time: 0.4,
          value: { ...base.transform, rotationX: 60 },
          easing: "linear",
        },
      ],
    },
  ];
  project.clips = states.map((state, index) => ({
    ...base,
    ...state,
    id: `state-${index}`,
    start: index * 0.4,
  }));
  const restored = validateProject(JSON.parse(JSON.stringify(project))),
    output = path.join(root, "result.mp4");
  await exportVideo(
    restored,
    output,
    path.join(root, "render"),
    false,
    new AbortController().signal,
    () => {},
  );
  for (let index = 0; index < states.length; index++) {
    const frame = path.join(root, `state-${index}.png`);
    await runProcess(findBinary("ffmpeg"), [
      "-y",
      "-ss",
      String(index * 0.4 + 0.2),
      "-i",
      output,
      "-frames:v",
      "1",
      frame,
    ]);
    const pixel = async (x: number, y: number) => [
      ...(await sharp(frame)
        .extract({ left: x, top: y, width: 1, height: 1 })
        .removeAlpha()
        .raw()
        .toBuffer()),
    ];
    const background = async (x: number, y: number) => {
      const color = await pixel(x, y);
      [84, 50, 178].forEach((channel, i) =>
        expect(Math.abs(color[i] - channel)).toBeLessThan(12),
      );
    };
    const colored = async (x: number, y: number, channel: number) => {
      const color = await pixel(x, y);
      expect(color[channel]).toBeGreaterThan(175);
      expect(color[2]).toBeLessThan(35);
    };
    await background(10, 60);
    if (index < 3) {
      await background(25, 60);
      await background(135, 60);
    }
    if (index === 0) await colored(105, 60, 1);
    if (index === 1) await colored(80, 60, 0);
    if (index === 2) {
      await background(45, 60);
      await colored(105, 60, 1);
    }
    if (index === 3) {
      await background(80, 30);
      await colored(110, 60, 1);
    }
    if (index === 4) {
      await background(120, 60);
      await colored(90, 60, 1);
    }
    if (index === 5) {
      const point = projectDelta(project.clips[index].transform, {
        x: -22.5,
        y: 0,
      });
      await colored(Math.round(80 + point.x), Math.round(60 + point.y), 0);
    }
    if (index === 6) await background(80, 60);
    if (index === 7) await colored(105, 35, 1);
  }
});
