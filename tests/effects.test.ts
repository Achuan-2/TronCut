import { expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createProject, defaultTransform } from "../shared/model";
import { defaultEffects, defaultCrop } from "../shared/effects";
import { exportVideo } from "../electron/export";
import { probeMedia } from "../electron/media";
import { mediaThumbnail } from "../electron/thumbnails";
import { findBinary, runProcess } from "../electron/process";

it("真实输出裁切、旋转、灰度与淡入：从右侧绿画面裁切得到灰色，开头显示背景", async () => {
  const root = path.resolve("test-output/effects");
  await fs.mkdir(root, { recursive: true });
  const source = path.join(root, "bands.png");
  await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><path fill="#c80000" d="M0 0H50V80H0Z"/><path fill="#00c800" d="M50 0H100V80H50Z"/></svg>',
    ),
  )
    .png()
    .toFile(source);
  const asset = await probeMedia(source),
    p = createProject("画面效果回归");
  p.canvas = { width: 160, height: 100, fps: 10, background: "#101010" };
  p.assets = [asset];
  p.exportSettings = { encoder: "software" };
  p.clips = [
    {
      id: "effect",
      trackId: "video",
      assetId: asset.id,
      kind: "image",
      name: "色块",
      start: 0,
      duration: 0.8,
      sourceIn: 0,
      speed: 1,
      volume: 1,
      podcast: false,
      transform: { ...defaultTransform },
      keyframes: [],
      rotation: 90,
      crop: { ...defaultCrop, left: 0.5 },
      effects: { ...defaultEffects, grayscale: true, flipX: true },
      fadeIn: 0.2,
    },
  ];
  const output = path.join(root, "effects.mp4");
  await exportVideo(
    p,
    output,
    path.join(root, "render"),
    false,
    new AbortController().signal,
    () => {},
  );
  for (const [time, filename] of [
    [0, "start.png"],
    [0.4, "middle.png"],
  ] as const) {
    await runProcess(findBinary("ffmpeg"), [
      "-y",
      "-ss",
      String(time),
      "-i",
      output,
      "-frames:v",
      "1",
      path.join(root, filename),
    ]);
  }
  const pixel = async (file: string) => [
    ...(await sharp(path.join(root, file))
      .extract({ left: 80, top: 50, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer()),
  ];
  const start = await pixel("start.png"),
    middle = await pixel("middle.png");
  expect(Math.max(...start)).toBeLessThan(22);
  expect(Math.max(...middle) - Math.min(...middle)).toBeLessThan(4);
  expect(middle[0]).toBeGreaterThan(100);
  expect(middle[0]).toBeLessThan(135);
  expect((await probeMedia(output)).duration).toBeCloseTo(0.8, 1);
  expect(await mediaThumbnail(asset, false, path.join(root, "cache"))).toMatch(
    /^data:image\/png;base64,/,
  );
});
