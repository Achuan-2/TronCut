import { expect, it } from "vitest";
import { cropClip, croppedTransform, dragCrop } from "../shared/crop";
import { defaultCrop, defaultEffects } from "../shared/effects";
import {
  createProject,
  defaultTransform,
  validateProject,
  type Clip,
} from "../shared/model";

const size = { width: 400, height: 200 };
const canvas = { width: 1000, height: 500 };
const clip: Clip = {
  id: "crop",
  kind: "image",
  name: "图片",
  trackId: "video",
  start: 0,
  duration: 5,
  sourceIn: 0,
  speed: 1,
  volume: 1,
  podcast: false,
  transform: defaultTransform,
  keyframes: [],
};

it("向内拖动左边裁剪，保留像素大小和右侧锚点；向外可恢复", () => {
  const crop = dragCrop(
    defaultCrop,
    defaultTransform,
    { x: 100, y: 0 },
    { x: -1, y: 0 },
    size,
  );
  expect(crop.left).toBe(0.25);
  const value = croppedTransform(clip, defaultTransform, crop, size, canvas);
  expect(value.scale).toBe(1);
  expect(value.x * canvas.width + (size.width * (1 - crop.left)) / 2).toBe(700);
  expect(
    dragCrop(crop, value, { x: -200, y: 0 }, { x: -1, y: 0 }, size),
  ).toEqual(defaultCrop);
});

it("旋转、翻转和缩放后，裁剪方向仍与屏幕上拖动的边缘一致", () => {
  const value = { ...defaultTransform, scale: 2, rotation: 90 };
  const flipped = { ...clip, effects: { ...defaultEffects, flipX: true } };
  const crop = dragCrop(
    defaultCrop,
    value,
    { x: 0, y: 200 },
    { x: -1, y: 0 },
    size,
    90,
    true,
  );
  expect(crop.right).toBeCloseTo(0.25);
  expect(crop.left).toBe(0);
  const result = croppedTransform(flipped, value, crop, size, canvas);
  expect(result.x).toBeCloseTo(0.5);
  expect(result.y).toBeCloseTo(0.7);
  expect(result.scale).toBe(2);
});

it("裁剪不能越过对边，保存及恢复裁剪保留已有动画和缓动", () => {
  const before = {
    ...clip,
    keyframes: [
      { time: 0, value: { ...defaultTransform } },
      {
        time: 2,
        value: { ...defaultTransform, x: 0.7, scale: 2 },
        animation: true as const,
        easing: "linear" as const,
      },
    ],
  };
  const crop = dragCrop(
    { ...defaultCrop, right: 0.5 },
    defaultTransform,
    { x: 10000, y: -10000 },
    { x: -1, y: 1 },
    size,
  );
  expect(crop.left + crop.right).toBeLessThan(0.99);
  expect(crop.bottom).toBe(0.95);
  const next = cropClip(before, crop, size, canvas);
  const project = createProject();
  project.assets = [
    {
      id: "source",
      name: "图片",
      path: "crop.png",
      kind: "image",
      duration: 5,
      width: 400,
      height: 200,
      hasAudio: false,
    },
  ];
  next.assetId = "source";
  project.clips = [next];
  expect(validateProject(project).clips[0].crop).toEqual(crop);
  expect(
    next.keyframes.map((frame) => [frame.time, frame.easing, frame.animation]),
  ).toEqual(
    before.keyframes.map((frame) => [
      frame.time,
      frame.easing,
      frame.animation,
    ]),
  );
  const restored = cropClip(next, defaultCrop, size, canvas);
  expect(restored.transform.x).toBeCloseTo(before.transform.x);
  expect(restored.transform.y).toBeCloseTo(before.transform.y);
  restored.keyframes.forEach((frame, index) => {
    expect(frame.value.x).toBeCloseTo(before.keyframes[index].value.x);
    expect(frame.value.y).toBeCloseTo(before.keyframes[index].value.y);
    expect(frame.value.scale).toBe(before.keyframes[index].value.scale);
  });
});
