import { expect, it } from "vitest";
import {
  createProject,
  defaultTransform,
  validateProject,
  type Clip,
} from "../shared/model";
import { animateContent, animateCrop } from "../shared/crop-animation";
import { transformAt, splitClip } from "../shared/editor";
import {
  animationEditTarget,
  animationRanges,
  retimeAnimation,
} from "../shared/animation-ranges";
import {
  snapshotAnimation,
  pasteAnimation,
  removeAnimation,
} from "../shared/animation-edit";
import { defaultCrop } from "../shared/effects";
import { visualClipAt } from "../shared/visual-state";

const clip: Clip = {
  id: "visual",
  assetId: "source",
  kind: "image",
  name: "图片",
  trackId: "video",
  start: 0,
  duration: 8,
  sourceIn: 0,
  speed: 1,
  volume: 1,
  podcast: false,
  transform: defaultTransform,
  keyframes: [],
};
const sample = (source: Clip, time: number) =>
  visualClipAt(source, transformAt(source, time));
const size = { width: 400, height: 200 },
  canvas = { width: 1000, height: 500 };

it("自动框内缩放/平移创建独立1秒动画，外框不变，静止区间不连箭头", () => {
  const first = animateContent(
    clip,
    { scale: 2, x: 0.2 },
    { time: 2, auto: true },
  );
  const second = animateContent(first, { scale: 3 }, { time: 5, auto: true });
  expect(
    animationRanges(second).map((range) => [range.start, range.end]),
  ).toEqual([
    [1, 2],
    [4, 5],
  ]);
  expect(sample(second, 0).contentTransform?.scale).toBe(1);
  expect(sample(second, 1.5).contentTransform?.scale).toBeCloseTo(1.5);
  expect(sample(second, 3).contentTransform?.scale).toBe(2);
  expect(sample(second, 5).contentTransform?.scale).toBe(3);
  for (const time of [0, 1, 1.5, 2, 3, 4, 5, 8]) {
    const value = transformAt(second, time);
    expect(value.x).toBe(0.5);
    expect(value.y).toBe(0.5);
    expect(value.scale).toBe(1);
  }
  const again = animateContent(second, { x: 0.3 }, { time: 5, auto: true });
  expect(again.keyframes).toHaveLength(second.keyframes.length);
  expect(sample(again, 2).contentTransform?.x).toBe(0.2);
});

it("关闭自动动画后编辑末尾只改终点，起点映射前一个终点；首次起点不新增箭头", () => {
  const first = animateContent(clip, { scale: 2 }, { time: 2, auto: true });
  const second = animateContent(first, { scale: 3 }, { time: 5, auto: true });
  const edited = animateContent(
    second,
    { scale: 4 },
    { time: 5, auto: false, endpoint: { time: 5, side: "end" } },
  );
  expect(sample(edited, 0).contentTransform?.scale).toBe(1);
  expect(sample(edited, 2).contentTransform?.scale).toBe(2);
  expect(sample(edited, 5).contentTransform?.scale).toBe(4);
  const target = animationEditTarget(edited, 4, "start");
  expect(target).toEqual({ time: 2, side: "end" });
  const start = animateContent(
    edited,
    { scale: 2.5 },
    { time: 2, auto: false, endpoint: target },
  );
  expect(sample(start, 3).contentTransform?.scale).toBe(2.5);
  expect(sample(start, 5).contentTransform?.scale).toBe(4);
  const initial = animateContent(
    start,
    { scale: 1.2 },
    { time: 1, auto: false, endpoint: { time: 1, side: "start" } },
  );
  expect(sample(initial, 0).contentTransform?.scale).toBe(1.2);
  expect(sample(initial, 2).contentTransform?.scale).toBe(2.5);
  expect(animationRanges(initial)).toHaveLength(2);
});

it("边缘裁剪动画保留对侧并独立编辑端点，静态修改不会抹去位置动画", () => {
  const first = animateCrop(
    clip,
    { ...defaultCrop, left: 0.25 },
    size,
    canvas,
    { time: 2, auto: true },
  );
  expect(animationRanges(first)).toHaveLength(1);
  expect(sample(first, 0).crop?.left).toBe(0);
  expect(sample(first, 1.5).crop?.left).toBeCloseTo(0.125);
  expect(sample(first, 2).crop?.left).toBe(0.25);
  for (const time of [0, 1.5, 2]) {
    const value = transformAt(first, time),
      crop = sample(first, time).crop!;
    expect(
      value.x * canvas.width +
        (size.width * value.scale * (1 - crop.left - crop.right)) / 2,
    ).toBeCloseTo(700);
  }
  const endpoint = animateCrop(
    first,
    { ...defaultCrop, left: 0.5 },
    size,
    canvas,
    { time: 2, auto: false, endpoint: { time: 2, side: "end" } },
  );
  expect(sample(endpoint, 0).crop?.left).toBe(0);
  expect(sample(endpoint, 2).crop?.left).toBe(0.5);
  const staticEdit = animateCrop(
    endpoint,
    { ...defaultCrop, top: 0.2 },
    size,
    canvas,
    { time: 2, auto: false },
  );
  expect(transformAt(staticEdit, 0).x).not.toBe(transformAt(staticEdit, 2).x);
  expect(sample(staticEdit, 0).crop?.top).toBe(0.2);
});

it("裁剪动画复制、拖动、删除、分割和保存保留内部画面状态", () => {
  const animated = animateContent(
    clip,
    { scale: 2, y: 0.2 },
    { time: 2, auto: true },
  );
  const range = animationRanges(animated)[0],
    copied = snapshotAnimation(animated, range)!;
  const pasted = pasteAnimation(clip, copied, 4);
  expect(sample(pasted, 0).contentTransform?.scale).toBe(1);
  expect(sample(pasted, 5).contentTransform?.scale).toBe(2);
  expect(animationRanges(pasted)).toHaveLength(1);
  const before = JSON.stringify(animated),
    moved = retimeAnimation(animated, range, "move", 2, 30);
  expect(JSON.stringify(animated)).toBe(before);
  expect(animationRanges(moved)[0].start).toBe(3);
  expect(sample(moved, 4).contentTransform?.y).toBe(0.2);
  const deleted = removeAnimation(animated, range);
  expect(animationRanges(deleted)).toHaveLength(0);
  expect(sample(deleted, 5).contentTransform?.scale).toBe(1);
  const project = createProject();
  project.assets = [
    {
      id: "source",
      kind: "image",
      name: "图片",
      path: "image.png",
      duration: 8,
      width: 400,
      height: 200,
      hasAudio: false,
    },
  ];
  project.clips = [animated];
  expect(
    validateProject(JSON.parse(JSON.stringify(project))).clips[0].keyframes,
  ).toEqual(animated.keyframes);
  const split = splitClip(project, clip.id, 1.5);
  expect(sample(split.clips[1], 0).contentTransform?.scale).toBeCloseTo(1.5);
  expect(sample(split.clips[1], 0.5).contentTransform?.scale).toBe(2);
});

it("已有静态裁剪和框内缩放首次加动画保留原状态，取消自动记录保留静态行为", () => {
  const old = {
    ...clip,
    crop: { ...defaultCrop, right: 0.2 },
    contentTransform: { x: 0.1, y: -0.1, scale: 1.5 },
  };
  const next = animateContent(old, { scale: 2 }, { time: 2, auto: true });
  expect(sample(next, 0).crop).toEqual(old.crop);
  expect(sample(next, 0).contentTransform).toEqual(old.contentTransform);
  const staticEdit = animateContent(
    old,
    { scale: 2 },
    { time: 2, auto: false },
  );
  expect(staticEdit.keyframes).toHaveLength(0);
  expect(staticEdit.contentTransform?.scale).toBe(2);
});
