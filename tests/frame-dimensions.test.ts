import { expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  createProject,
  defaultTransform,
  newText,
  validateProject,
  type Clip,
} from "../shared/model";
import {
  dimensionTransform,
  resizeHandles,
  resizeTransform,
  framePosition,
} from "../shared/canvas";
import { localDelta, projectDelta } from "../shared/rotation";
import {
  setTransform,
  transformAt,
  setKeyframeTransform,
} from "../shared/editor";
import { animationRanges, sameTransform } from "../shared/animation-ranges";
import { snapshotAnimation, pasteAnimation } from "../shared/animation-edit";
import { exportFrame, exportVideo } from "../electron/export";
import { probeMedia } from "../electron/media";
import { findBinary, runProcess } from "../electron/process";
import { openProject, saveProject } from "../electron/project-store";

it("宽高锁定保持当前比例，解锁只修改对应轴，非法尺寸不提交", () => {
  const value = { ...defaultTransform, scale: 0.5, scaleX: 1.5, scaleY: 0.75 };
  const size = { width: 400, height: 200 };
  expect(dimensionTransform(value, size, "width", 600, true)).toEqual({
    scale: 1,
  });
  expect(dimensionTransform(value, size, "width", 600, false)).toEqual({
    scaleX: 3,
  });
  expect(dimensionTransform(value, size, "height", 150, false)).toEqual({
    scaleY: 1.5,
  });
  expect(dimensionTransform(value, size, "height", 150, true)).toEqual({
    scale: 1,
  });
  for (const pixels of [0, -1, Infinity, NaN, 1000000])
    expect(dimensionTransform(value, size, "width", pixels, false)).toBeNull();
});

it("解锁拖动八个手柄保持对侧锚点，倾斜与三轴旋转的坐标换算可逆", () => {
  const canvas = { width: 1000, height: 600 },
    size = { width: 320, height: 180 };
  const value = {
    ...defaultTransform,
    scale: 0.8,
    scaleX: 1.5,
    scaleY: 0.75,
    rotation: 25,
    rotationX: 15,
    rotationY: -20,
    skew: 18,
    z: 100,
  };
  const delta = { x: 20, y: -10 };
  const restored = localDelta(value, projectDelta(value, delta));
  expect(restored.x).toBeCloseTo(delta.x);
  expect(restored.y).toBeCloseTo(delta.y);
  const anchor = (pose: typeof value, handle: { x: number; y: number }) => {
    const offset = projectDelta(pose, {
      x: (-handle.x * size.width * pose.scale) / 2,
      y: (-handle.y * size.height * pose.scale) / 2,
    });
    return {
      x: pose.x * canvas.width + offset.x,
      y: pose.y * canvas.height + offset.y,
    };
  };
  for (const handle of resizeHandles) {
    const resized = resizeTransform(
      value,
      delta,
      handle,
      size,
      canvas,
      0,
      false,
    ) as typeof value;
    const before = anchor(value, handle),
      after = anchor(resized, handle);
    expect(after.x).toBeCloseTo(before.x, 8);
    expect(after.y).toBeCloseTo(before.y, 8);
    if (!handle.x) expect(resized.scaleX).toBe(value.scaleX);
    if (!handle.y) expect(resized.scaleY).toBe(value.scaleY);
    expect(resized.scale).toBe(value.scale);
  }
  const position = framePosition(
    { ...defaultTransform, scaleX: 2, scaleY: 0.5 },
    size,
    canvas,
    1,
    1,
  );
  expect(position.x * canvas.width + size.width).toBeCloseTo(canvas.width);
  expect(position.y * canvas.height + size.height / 4).toBeCloseTo(
    canvas.height,
  );
});

it("独立缩放关键帧缺省为 1，端点编辑和复制保留动画，旧项目不增加字段", () => {
  const legacy = newText("titles", 0);
  expect(transformAt(legacy, 0)).toEqual(defaultTransform);
  expect(
    validateProject({ ...createProject(), clips: [legacy] }).clips[0]
      .lockAspectRatio,
  ).toBeUndefined();
  const clip = setTransform(legacy, { scaleX: 2 }, 2, true);
  expect(transformAt(clip, 1).scaleX).toBe(1);
  expect(transformAt(clip, 1.5).scaleX).toBeCloseTo(1.5);
  expect(
    sameTransform(defaultTransform, {
      ...defaultTransform,
      scaleX: 1,
      scaleY: 1,
    }),
  ).toBe(true);
  expect(animationRanges(clip)).toHaveLength(1);
  const edited = setKeyframeTransform(clip, { scaleY: 0.5 }, 2);
  expect(transformAt(edited, 1).scaleY).toBe(1);
  expect(transformAt(edited, 2).scaleY).toBe(0.5);
  const initial = setKeyframeTransform(edited, { scaleX: 0.5 }, 1);
  expect(transformAt(initial, 2).scaleX).toBe(2);
  const copy = snapshotAnimation(clip, animationRanges(clip)[0])!;
  const pasted = pasteAnimation(legacy, copy, 3);
  expect(transformAt(pasted, 3).scaleX).toBe(1);
  expect(transformAt(pasted, 4).scaleX).toBe(2);
});

it("独立宽高、裁切和关键帧在保存重开、真实截帧及视频输出中一致", async () => {
  const root = path.resolve(`test-output/frame-dimensions-${Date.now()}`);
  await fs.mkdir(root, { recursive: true });
  const png = path.join(root, "green.png");
  await sharp({
    create: { width: 200, height: 100, channels: 3, background: "#00c800" },
  })
    .png()
    .toFile(png);
  const asset = await probeMedia(png);
  const project = createProject();
  project.canvas = { width: 320, height: 180, fps: 10, background: "#5432b2" };
  project.assets = [asset];
  project.exportSettings = { encoder: "software" };
  const base: Clip = {
    ...newText("video", 0),
    kind: "image",
    assetId: asset.id,
    duration: 1,
    lockAspectRatio: false,
    transform: { ...defaultTransform, scale: 0.5, scaleX: 0.5, scaleY: 1.25 },
  };
  const inspect = async (file: string, width: number, height: number) => {
    const { data, info } = await sharp(file)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const green = (x: number, y: number) =>
      data[(y * info.width + x) * info.channels + 1] > 185;
    expect(green(160 - width / 2 + 3, 90 - height / 2 + 3)).toBe(true);
    expect(green(160 + width / 2 - 3, 90 + height / 2 - 3)).toBe(true);
    expect(green(160 - width / 2 - 3, 90)).toBe(false);
    expect(green(160, 90 - height / 2 - 3)).toBe(false);
  };
  for (const [index, clip] of [
    base,
    { ...base, crop: { left: 0.25, top: 0, right: 0, bottom: 0 } },
  ].entries()) {
    project.clips = [clip];
    const file = path.join(root, `${index}.troncut`);
    await saveProject(project, file);
    const reopened = await openProject(file);
    expect(reopened.clips[0]).toMatchObject({
      lockAspectRatio: false,
      transform: { scaleX: 0.5, scaleY: 1.25 },
    });
    const output = path.join(root, `${index}.png`);
    await exportFrame(
      reopened,
      0.5,
      output,
      path.join(root, `frame-${index}`),
      AbortSignal.timeout(20000),
    );
    await inspect(output, index ? 60 : 80, 100);
  }
  project.clips = [
    {
      ...base,
      transform: { ...base.transform, scaleY: 1 },
      keyframes: [
        { time: 0, value: { ...base.transform, scaleY: 1 } },
        {
          time: 1,
          value: { ...base.transform, scaleX: 1.5, scaleY: 1 },
          easing: "linear",
        },
      ],
    },
  ];
  const video = path.join(root, "animated.mp4");
  await exportVideo(
    project,
    video,
    path.join(root, "video"),
    false,
    AbortSignal.timeout(20000),
    () => { },
  );
  const frame = path.join(root, "animated.png");
  await runProcess(findBinary("ffmpeg"), [
    "-y",
    "-ss",
    "0.5",
    "-i",
    video,
    "-frames:v",
    "1",
    frame,
  ]);
  await inspect(frame, 160, 80);
  // Locking again scales both existing axis factors together. A subsequent
  // uniform animation must also retain changing dimensions in the video.
  project.clips = [
    {
      ...base,
      lockAspectRatio: true,
      keyframes: [
        { time: 0, value: base.transform },
        { time: 1, value: { ...base.transform, scale: 1 }, easing: "linear" },
      ],
    },
  ];
  const lockedVideo = path.join(root, "locked.mp4");
  await exportVideo(
    project,
    lockedVideo,
    path.join(root, "locked-video"),
    false,
    AbortSignal.timeout(20000),
    () => { },
  );
  const lockedFrame = path.join(root, "locked.png");
  await runProcess(findBinary("ffmpeg"), [
    "-y",
    "-ss",
    "0.5",
    "-i",
    lockedVideo,
    "-frames:v",
    "1",
    lockedFrame,
  ]);
  await inspect(lockedFrame, 120, 150);
}, 30000);
