import { expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createProject, defaultTransform, type Clip } from "../shared/model";
import { cropClip } from "../shared/crop";
import { defaultCrop, defaultEffects } from "../shared/effects";
import { exportVideo } from "../electron/export";
import { probeMedia } from "../electron/media";
import { findBinary, runProcess } from "../electron/process";

it("画布裁剪保存后真实导出保持保留区域的位置，水平翻转也一致", async () => {
  const root = path.resolve("test-output/canvas-crop");
  await fs.mkdir(root, { recursive: true });
  const source = path.join(root, "source.png");
  await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><path fill="#c80000" d="M0 0H50V100H0Z"/><path fill="#00c800" d="M50 0H100V100H50Z"/></svg>',
    ),
  )
    .png()
    .toFile(source);
  const project = createProject();
  project.canvas = { width: 200, height: 100, fps: 10, background: "#101010" };
  project.exportSettings = { encoder: "software" };
  const asset = await probeMedia(source);
  project.assets = [asset];
  const base: Clip = {
    id: "normal",
    assetId: asset.id,
    trackId: "video",
    kind: "image",
    name: "图片",
    start: 0,
    duration: 0.4,
    sourceIn: 0,
    speed: 1,
    volume: 1,
    podcast: false,
    transform: defaultTransform,
    keyframes: [],
  };
  project.clips = [
    base,
    {
      ...base,
      id: "flipped",
      start: 0.4,
      effects: { ...defaultEffects, flipX: true },
    },
  ].map((clip) =>
    cropClip(
      clip,
      { ...defaultCrop, left: 0.5 },
      { width: 100, height: 100 },
      project.canvas,
    ),
  );
  const output = path.join(root, "crop.mp4");
  await exportVideo(
    JSON.parse(JSON.stringify(project)),
    output,
    path.join(root, "render"),
    false,
    new AbortController().signal,
    () => {},
  );
  for (const [time, greenX, blankX] of [
    [0.2, 125, 75],
    [0.6, 75, 125],
  ]) {
    const image = path.join(root, `frame-${time}.png`);
    await runProcess(findBinary("ffmpeg"), [
      "-y",
      "-ss",
      String(time),
      "-i",
      output,
      "-frames:v",
      "1",
      image,
    ]);
    const pixel = (x: number) =>
      sharp(image)
        .extract({ left: x, top: 50, width: 1, height: 1 })
        .removeAlpha()
        .raw()
        .toBuffer();
    const green = await pixel(greenX),
      blank = await pixel(blankX);
    expect(green[1]).toBeGreaterThan(175);
    expect(green[0]).toBeLessThan(20);
    expect(Math.max(...blank)).toBeLessThan(25);
  }
});
