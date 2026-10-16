import { expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { newText, type Clip } from "../shared/model";
import { mediaFrameFilters } from "../electron/visual-transform";
import {
  staticFrameMask,
  staticFrameMaskFilters,
} from "../electron/static-frame-mask";
import { findBinary, runProcess } from "../electron/process";

it.each([
  { radius: 13 },
  { radius: 57, unit: "percent" as const },
  {
    radius: 200,
    corners: {
      topLeft: false,
      topRight: true,
      bottomRight: false,
      bottomLeft: true,
    },
  },
])("预生成圆角蒙版匹配 FFmpeg GEQ，并保留源透明度：%j", async (mediaFrame) => {
  const root = path.resolve(
    `test-output/static-mask-${Date.now()}-${mediaFrame.radius}`,
  );
  await fs.mkdir(root, { recursive: true });
  const width = 91,
    height = 65,
    fit = 0.7;
  const clip: Clip = { ...newText("video", 0), kind: "image", mediaFrame };
  const input = path.join(root, "source.png");
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = 72;
    pixels[i * 4 + 1] = 153;
    pixels[i * 4 + 2] = 211;
    pixels[i * 4 + 3] = 47 + (i % 209);
  }
  await sharp(pixels, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(input);
  const optimized = await staticFrameMaskFilters({
    clip,
    width,
    height,
    fit,
    source: "source",
    input: 1,
    layer: 0,
    file: path.join(root, "mask.pgm"),
  });
  expect(optimized).toBeDefined();
  const graph = [
    "[0:v]format=rgba,split[reference][source]",
    `[reference]${mediaFrameFilters(clip, fit).join(",")}[old]`,
    ...optimized!.filters,
  ].join(";");
  await runProcess(findBinary("ffmpeg"), [
    "-y",
    "-filter_complex_threads",
    "1",
    "-threads",
    "1",
    "-i",
    input,
    ...optimized!.args,
    "-filter_complex",
    graph,
    "-map",
    "[old]",
    "-frames:v",
    "1",
    path.join(root, "old.png"),
    "-map",
    `[${optimized!.label}]`,
    "-frames:v",
    "1",
    path.join(root, "new.png"),
  ]);
  const decode = (name: string) =>
    sharp(path.join(root, name)).ensureAlpha().raw().toBuffer();
  const before = await decode("old.png"),
    after = await decode("new.png");
  expect(after).toEqual(before);
});

it("定时圆角和动画裁剪保留通用渲染，内容缩放复用固定外框", () => {
  const clip: Clip = {
    ...newText("video", 0),
    kind: "video",
    mediaFrame: { radius: 12 },
  };
  expect(
    staticFrameMask(
      { ...clip, mediaFrame: { radius: 12, window: { start: 0, end: 1 } } },
      100,
      60,
      1,
    ),
  ).toBeUndefined();
  expect(
    staticFrameMask(
      {
        ...clip,
        keyframes: [{ time: 1, value: { ...clip.transform, cropLeft: 0.1 } }],
      },
      100,
      60,
      1,
    ),
  ).toBeUndefined();
  expect(
    staticFrameMask(
      { ...clip, mediaFrame: { radius: 12, enabled: false } },
      100,
      60,
      1,
    ),
  ).toBeUndefined();
  expect(
    staticFrameMask(
      {
        ...clip,
        keyframes: [
          {
            time: 1,
            value: { ...clip.transform, contentScale: 2 },
            recordingZoom: true,
          },
        ],
      },
      100,
      60,
      1,
    ),
  ).toBeDefined();
});
