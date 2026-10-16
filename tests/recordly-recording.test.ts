import { expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  recordingCameraFrames,
  recordingTelemetry,
} from "../shared/recording-camera";
import {
  addRecordedAssets,
  defaultRecordingSettings,
  recordingSettingsSchema,
} from "../shared/recording";
import {
  createProject,
  defaultTransform,
  validateProject,
  type Asset,
  type Clip,
} from "../shared/model";
import { transformAt } from "../shared/editor";
import {
  cursorSvg,
  cursorStyles,
  cursorShapes,
  cursorAnchor,
  cursorAspect,
  defaultCursorStyle,
} from "../shared/cursor";
import { RecordingStyleStore } from "../electron/recording-style";
import { exportVideo, exportFrame } from "../electron/export";
import { probeMedia } from "../electron/media";
import { findBinary, runProcess } from "../electron/process";

const sample = (time: number, x: number, click = false) => ({
  time,
  x,
  y: 0.5,
  click,
  visible: true,
});
const asset: Asset = {
  id: "screen",
  path: "screen.mp4",
  name: "录屏",
  kind: "video",
  width: 160,
  height: 90,
  duration: 8,
  hasAudio: false,
  cursor: {
    samples: [
      sample(0, 0.2),
      sample(1, 0.2, true),
      sample(1.1, 0.2),
      sample(2, 0.2, true),
      sample(2.1, 0.2),
      sample(2.5, 0.2),
      sample(3, 0.8, true),
      sample(3.1, 0.8),
      sample(4, 0.8, true),
      sample(4.1, 0.8),
    ],
  },
};
const clip: Clip = {
  id: "clip",
  trackId: "video",
  assetId: asset.id,
  name: "录屏",
  kind: "video",
  start: 2,
  sourceIn: 0,
  duration: 8,
  speed: 1,
  volume: 1,
  podcast: false,
  transform: defaultTransform,
  keyframes: [],
};

it("镜头在同一点击聚类内从左平移到右，反向拖动播放头得到相同路径且不露出源边界", () => {
  const frames = recordingCameraFrames(asset, clip, 2);
  const animated = { ...clip, keyframes: frames };
  const before = transformAt(animated, 2.3),
    after = transformAt(animated, 3.8);
  expect(before.contentX).toBeGreaterThan(0.3);
  expect(after.contentX).toBeLessThan(-0.3);
  expect(before.contentScale).toBeGreaterThan(1.9);
  expect(after.contentScale).toBeGreaterThan(1.9);
  expect(transformAt(animated, 2.3)).toEqual(before);
  for (let t = 0; t <= 8; t += 0.037) {
    const pose = transformAt(animated, t);
    expect(Math.abs(pose.contentX ?? 0)).toBeLessThanOrEqual(
      ((pose.contentScale ?? 1) - 1) / 2 + 0.002,
    );
  }
  expect(transformAt(animated, 8)).toMatchObject({
    contentX: 0,
    contentY: 0,
    contentScale: 1,
  });
  const trimmed = { ...clip, sourceIn: 2, speed: 2, duration: 2 };
  expect(
    recordingTelemetry(asset, trimmed)
      .filter((s) => s.interactionType === "click")
      .map((s) => s.timeMs),
  ).toEqual([0, 500, 1000]);
});

it("两种缩放范围正确分配录屏与背景动画，旧设置保留背景固定模式", () => {
  const background = {
    ...asset,
    id: "background",
    cursor: undefined,
    kind: "image" as const,
  };
  const fixed = addRecordedAssets(
    createProject(),
    [{ asset, kind: "screen" }],
    defaultRecordingSettings,
    1,
    background,
  );
  expect(fixed.clips[1].keyframes).toEqual([]);
  const scene = validateProject(
    addRecordedAssets(
      createProject(),
      [{ asset, kind: "screen" }],
      { ...defaultRecordingSettings, zoomBackground: true },
      1,
      background,
    ),
  );
  const screenPose = transformAt(scene.clips[0], 3.8);
  const bgPose = transformAt(scene.clips[1], 3.8);
  expect(screenPose.scale).toBeGreaterThan(1.4);
  expect(bgPose.scale).toBeGreaterThan(1.7);
  expect(screenPose.x).toBeCloseTo(bgPose.x);
  expect(screenPose.y).toBeCloseTo(bgPose.y);
  const { zoomBackground: _removed, ...old } = defaultRecordingSettings;
  expect(recordingSettingsSchema.parse(old).zoomBackground).toBe(false);
});

it("长录制的静止间隔不产生逐帧关键帧，点击镜头及末尾复位仍保留", () => {
  const long = {
    ...asset,
    duration: 3600,
    cursor: {
      samples: [
        sample(2, 0.2, true),
        sample(2.1, 0.2),
        sample(3590, 0.8, true),
        sample(3590.1, 0.8),
      ],
    },
  };
  const frames = recordingCameraFrames(long, { ...clip, duration: 3600 }, 2);
  expect(frames.length).toBeLessThan(200);
  expect(
    Math.max(
      ...frames
        .filter((frame) => frame.time < 10)
        .map((frame) => frame.value.contentScale ?? 1),
    ),
  ).toBeGreaterThan(1.5);
  expect(
    Math.max(
      ...frames
        .filter((frame) => frame.time > 3585)
        .map((frame) => frame.value.contentScale ?? 1),
    ),
  ).toBeGreaterThan(1.5);
  expect(frames.at(-1)).toMatchObject({
    time: 3600,
    value: { contentScale: 1, contentX: 0, contentY: 0 },
  });
});

it("Recordly 的所有内置鼠标图形可栅格化，热点和宽高比与预览导出共用", async () => {
  for (const style of Object.keys(
    cursorStyles,
  ) as (keyof typeof cursorStyles)[]) {
    for (const shape of cursorShapes) {
      const svg = cursorSvg({ ...defaultCursorStyle, style }, shape);
      const output = await sharp(Buffer.from(svg)).png().toBuffer();
      expect(output.length).toBeGreaterThan(100);
      expect(cursorAspect(style, shape)).toBeGreaterThan(0);
      expect(cursorAnchor(style, shape).x).toBeGreaterThanOrEqual(0);
      expect(cursorAnchor(style, shape).x).toBeLessThanOrEqual(1);
    }
  }
});

it("动态壁纸循环导出到录屏末尾，暂停导出帧也按同一源时间取帧", async () => {
  const root = path.resolve(`test-output/recordly-wallpaper-${Date.now()}`);
  const bundled = path.join(root, "bundled");
  await fs.mkdir(bundled, { recursive: true });
  const wallpaper = path.join(bundled, "wispysky.mp4");
  await runProcess(findBinary("ffmpeg"), [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=red:s=160x90:r=10:d=0.2",
    "-f",
    "lavfi",
    "-i",
    "color=blue:s=160x90:r=10:d=0.2",
    "-filter_complex",
    "[0:v][1:v]concat=n=2:v=1:a=0",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    wallpaper,
  ]);
  const screenFile = path.join(root, "screen.mp4");
  await runProcess(findBinary("ffmpeg"), [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=white:s=160x90:r=10:d=1.4",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    screenFile,
  ]);
  const store = new RecordingStyleStore(root, bundled);
  const background = await store.background(160, 90, "wispysky");
  expect(await fs.readFile(background.path)).toEqual(
    await fs.readFile(wallpaper),
  );
  const project = createProject();
  project.canvas = { width: 160, height: 90, fps: 10, background: "#000000" };
  project.exportSettings = { encoder: "software" };
  const screen = await probeMedia(screenFile);
  const imported = addRecordedAssets(
    project,
    [{ asset: screen, kind: "screen" }],
    {
      ...defaultRecordingSettings,
      preset: "wispysky",
      autoZoom: false,
      padding: 0.2,
    },
    0,
    background,
  );
  expect(imported.clips[1]).toMatchObject({
    kind: "video",
    loop: true,
    volume: 0,
    duration: screen.duration,
  });
  const signal = AbortSignal.timeout(30000),
    output = path.join(root, "loop.mp4");
  await exportVideo(
    imported,
    output,
    path.join(root, "render"),
    false,
    signal,
    () => {},
  );
  for (const [time, color] of [
    [0.1, "red"],
    [0.3, "blue"],
    [0.9, "red"],
    [1.1, "blue"],
  ] as const) {
    const frame = path.join(root, `frame-${time}.png`);
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
    const rgb = await sharp(frame)
      .extract({ left: 2, top: 2, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer();
    expect(rgb[color === "red" ? 0 : 2]).toBeGreaterThan(220);
  }
  const still = path.join(root, "still.png");
  await exportFrame(imported, 1.1, still, path.join(root, "still"), signal);
  const rgb = await sharp(still)
    .extract({ left: 2, top: 2, width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer();
  expect(rgb[2]).toBeGreaterThan(220);
}, 45000);

it("鼠标箭头与文本形态在导出中随原始轨迹切换，保持同一热点", async () => {
  const root = path.resolve(`test-output/recordly-cursor-shapes-${Date.now()}`);
  await fs.mkdir(root, { recursive: true });
  const file = path.join(root, "screen.mp4");
  await runProcess(findBinary("ffmpeg"), [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=black:s=160x100:r=10:d=1",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    file,
  ]);
  const source = await probeMedia(file);
  source.cursor = {
    samples: [
      {
        time: 0,
        x: 0.5,
        y: 0.5,
        visible: true,
        click: false,
        cursorType: "arrow",
      },
      {
        time: 0.5,
        x: 0.5,
        y: 0.5,
        visible: true,
        click: false,
        cursorType: "text",
      },
    ],
  };
  const project = createProject();
  project.canvas = { width: 160, height: 100, fps: 10, background: "#000000" };
  project.exportSettings = { encoder: "software" };
  const imported = addRecordedAssets(
    project,
    [{ asset: source, kind: "screen" }],
    {
      ...defaultRecordingSettings,
      background: false,
      autoZoom: false,
      cursor: { ...defaultCursorStyle, style: "windows11", size: 24 },
    },
    0,
  );
  const out = path.join(root, "cursor.mp4");
  await exportVideo(
    imported,
    out,
    path.join(root, "render"),
    false,
    AbortSignal.timeout(20000),
    () => {},
  );
  const pixels: Buffer[] = [];
  for (const time of [0.2, 0.7]) {
    const frame = path.join(root, `cursor-${time}.png`);
    await runProcess(findBinary("ffmpeg"), [
      "-y",
      "-ss",
      String(time),
      "-i",
      out,
      "-frames:v",
      "1",
      frame,
    ]);
    pixels.push(
      await sharp(frame)
        .extract({ left: 50, top: 20, width: 60, height: 60 })
        .removeAlpha()
        .raw()
        .toBuffer(),
    );
  }
  expect(
    pixels[0].filter((v, i) => Math.abs(v - pixels[1][i]) > 30).length,
  ).toBeGreaterThan(50);
});

it("自动平移和背景缩放两种模式真实导出，非零起点保持同一镜头路径", async () => {
  const root = path.resolve(`test-output/recordly-pan-${Date.now()}`);
  await fs.mkdir(root, { recursive: true });
  const file = path.join(root, "screen.mp4");
  await runProcess(findBinary("ffmpeg"), [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=red:s=160x90:r=10:d=8,drawbox=x=80:y=0:w=80:h=90:color=blue:t=fill",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    file,
  ]);
  const source = { ...(await probeMedia(file)), cursor: asset.cursor };
  const background = await new RecordingStyleStore(root).background(
    160,
    90,
    "violet",
  );
  const project = createProject();
  project.canvas = { width: 160, height: 90, fps: 10, background: "#000000" };
  project.exportSettings = { encoder: "software" };
  const signal = AbortSignal.timeout(30000);
  for (const zoomBackground of [false, true]) {
    const imported = addRecordedAssets(
      project,
      [{ asset: source, kind: "screen" }],
      {
        ...defaultRecordingSettings,
        zoom: 2,
        zoomBackground,
        cursor: { ...defaultCursorStyle, style: "hidden" },
      },
      0.5,
      background,
    );
    const out = path.join(root, `pan-${zoomBackground}.mp4`);
    await exportVideo(
      imported,
      out,
      path.join(root, `render-${zoomBackground}`),
      false,
      signal,
      () => {},
    );
    const pixels: Buffer[] = [];
    for (const [time, channel] of [
      [2.8, 0],
      [4.3, 2],
    ] as const) {
      const frame = path.join(root, `pan-${zoomBackground}-${time}.png`);
      await runProcess(findBinary("ffmpeg"), [
        "-y",
        "-ss",
        String(time),
        "-i",
        out,
        "-frames:v",
        "1",
        frame,
      ]);
      const center = await sharp(frame)
        .extract({ left: 80, top: 45, width: 1, height: 1 })
        .removeAlpha()
        .raw()
        .toBuffer();
      expect(center[channel]).toBeGreaterThan(220);
      pixels.push(
        await sharp(frame)
          .extract({ left: 2, top: 2, width: 1, height: 1 })
          .removeAlpha()
          .raw()
          .toBuffer(),
      );
    }
    if (!zoomBackground)
      expect(pixels[0].every((v, i) => Math.abs(v - pixels[1][i]) < 6)).toBe(
        true,
      );
    else
      expect(pixels[0].some((v, i) => Math.abs(v - pixels[1][i]) > 10)).toBe(
        true,
      );
  }
}, 45000);
