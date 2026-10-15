import { expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { RecordingStyleStore } from "../electron/recording-style";
import {
  defaultRecordingSettings,
  addRecordedAssets,
} from "../shared/recording";
import { createProject } from "../shared/model";
import { exportVideo, exportFrame } from "../electron/export";
import { probeMedia } from "../electron/media";
import { findBinary, runProcess } from "../electron/process";
import { saveProject, openProject } from "../electron/project-store";

it("真实导出和归档重开保留背景、圆角与自动缩放，放大画面时背景像素不变", async () => {
  const root = path.resolve(`test-output/recording-style-${Date.now()}`);
  await fs.mkdir(root, { recursive: true });
  const store = new RecordingStyleStore(root);
  expect(await store.read()).toEqual(defaultRecordingSettings);
  const settings = {
    ...defaultRecordingSettings,
    preset: "violet" as const,
    cursor: { ...defaultRecordingSettings.cursor, style: "hidden" as const },
  };
  await store.save(settings);
  expect(await new RecordingStyleStore(root).read()).toEqual(settings);
  const source = path.join(root, "screen.mp4");
  await runProcess(findBinary("ffmpeg"), [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=white:s=320x180:r=10:d=5,drawbox=x=212:y=78:w=24:h=24:color=red:t=fill",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    source,
  ]);
  const asset = await probeMedia(source);
  asset.cursor = {
    samples: [
      { time: 0, x: 0.2, y: 0.5, visible: true, click: false },
      { time: 0.5, x: 0.4, y: 0.5, visible: true, click: false },
      { time: 1, x: 0.55, y: 0.5, visible: true, click: false },
      { time: 1.5, x: 0.7, y: 0.5, visible: true, click: true },
      { time: 2, x: 0.75, y: 0.5, visible: true, click: false },
      { time: 3, x: 0.85, y: 0.5, visible: true, click: false },
      { time: 4, x: 0.2, y: 0.5, visible: true, click: false },
    ],
  };
  const project = createProject();
  project.canvas = { width: 320, height: 180, fps: 10, background: "#000000" };
  project.exportSettings = { encoder: "software" };
  const background = await store.background(320, 180, settings.preset);
  const styled = addRecordedAssets(
    project,
    [{ asset, kind: "screen" }],
    settings,
    0,
    background,
  );
  const archive = path.join(root, "录屏.troncut");
  await saveProject(styled, archive);
  const reopened = await openProject(archive);
  expect(reopened.clips.find((c) => c.kind === "video")!.keyframes).toEqual(
    styled.clips[0].keyframes,
  );
  expect(reopened.clips[0].mediaFrame).toEqual({ radius: 18 });
  const output = path.join(root, "recording.mp4"),
    signal = new AbortController().signal;
  await exportVideo(
    reopened,
    output,
    path.join(root, "render"),
    false,
    signal,
    () => {},
  );
  const pixels: number[][] = [];
  for (const [i, time] of [0, 2.1].entries()) {
    const frame = path.join(root, `frame-${i}.png`);
    await runProcess(findBinary("ffmpeg"), [
      "-y",
      "-ss",
      String(time),
      "-i",
      output,
      "-frames:v",
      "1",
      frame,
    ]);
    const { data, info } = await sharp(frame)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const rgb = (x: number, y: number) => [
      ...data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3),
    ];
    pixels.push([...rgb(8, 8), ...rgb(27, 16)]);
    const center = rgb(160, 90);
    if (i === 0) expect(Math.min(...center)).toBeGreaterThan(230);
    else {
      expect(center[0]).toBeGreaterThan(220);
      expect(center[1]).toBeLessThan(40);
    }
    expect(Math.max(...rgb(27, 16))).toBeLessThan(200); // Rounded corner reveals the gradient.
  }
  expect(
    pixels[0].every((value, i) => Math.abs(value - pixels[1][i]) <= 6),
  ).toBe(true);
  const still = path.join(root, "snapshot.png");
  await exportFrame(reopened, 2.1, still, path.join(root, "snapshot"), signal);
  const { data, info } = await sharp(still)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(data[(90 * info.width + 160) * 3]).toBeGreaterThan(220);
  expect(data[(90 * info.width + 160) * 3 + 1]).toBeLessThan(40);
}, 90000);
