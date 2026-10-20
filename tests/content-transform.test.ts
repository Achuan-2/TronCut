import { expect, it } from "vitest";
import {
  contentLayout,
  cropClip,
  defaultContentTransform,
  panContent,
  setContentTransform,
} from "../shared/crop";
import { defaultCrop, defaultEffects } from "../shared/effects";
import {
  createProject,
  defaultTransform,
  validateProject,
  type Clip,
} from "../shared/model";
import {
  transformAt,
  setTransform,
  setKeyframeTransform,
} from "../shared/editor";
import { animationRanges, retimeAnimation } from "../shared/animation-ranges";
import { snapshotAnimation, pasteAnimation } from "../shared/animation-edit";
import { projectDelta, localDelta } from "../shared/rotation";

const base: Clip = {
  id: "clip",
  kind: "image",
  assetId: "source",
  name: "图片",
  trackId: "video",
  start: 0,
  duration: 10,
  sourceIn: 0,
  speed: 1,
  volume: 1,
  podcast: false,
  transform: defaultTransform,
  keyframes: [],
};
const size = { width: 400, height: 200 },
  canvas = { width: 1000, height: 500 };

it("框内缩放和平移不修改外框及任何动画端点，旧项目默认完整画面", () => {
  const animated = setTransform(base, { x: 0.7 }, 3, true);
  const next = setContentTransform(animated, { scale: 2, x: 0.1 });
  expect(next.transform).toBe(animated.transform);
  expect(next.keyframes).toBe(animated.keyframes);
  expect(next.contentTransform).toEqual({ x: 0.1, y: 0, scale: 2 });
  expect(contentLayout(base, size)).toEqual({
    width: 400,
    height: 200,
    left: 0,
    top: 0,
  });
  expect(contentLayout(next, size)).toEqual({
    width: 800,
    height: 400,
    left: -160,
    top: -100,
  });
  const project = createProject();
  project.assets = [
    {
      id: "source",
      name: "图片",
      path: "source.png",
      kind: "image",
      duration: 10,
      width: 400,
      height: 200,
      hasAudio: false,
    },
  ];
  project.clips = [next];
  expect(
    validateProject(JSON.parse(JSON.stringify(project))).clips[0]
      .contentTransform,
  ).toEqual(next.contentTransform);
  expect(setContentTransform(base, { scale: NaN })).toBe(base);
});

it("斜置和翻转的框内拖动换算为正确方向，边缘裁剪不使放大的内容跳动", () => {
  const turned = {
    ...base,
    transform: { ...defaultTransform, rotation: 90, rotationY: 60 },
    effects: { ...defaultEffects, flipX: true },
  };
  expect(
    panContent(
      turned,
      turned.transform,
      defaultContentTransform,
      { x: 0, y: 50 },
      size,
    ).x,
  ).toBeCloseTo(-0.25);
  const zoomed = setContentTransform(base, { scale: 2, x: 0.1 });
  const cropped = cropClip(zoomed, { ...defaultCrop, left: 0.2 }, size, canvas);
  const screenOrigin = (clip: Clip) =>
    clip.transform.x * canvas.width -
    (size.width * (1 - (clip.crop?.left ?? 0) - (clip.crop?.right ?? 0))) / 2 +
    contentLayout(clip, size).left;
  expect(screenOrigin(cropped)).toBeCloseTo(screenOrigin(zoomed));
});

it("三轴旋转关键帧独立插值、生成动画箭头、复制相对角度及保存", () => {
  const animated = setTransform(
    base,
    { rotationX: 60, rotationY: 30, rotation: 10 },
    2,
    true,
  );
  expect(animationRanges(animated)).toHaveLength(1);
  expect(transformAt(animated, 0).rotationX).toBe(0);
  expect(transformAt(animated, 1.5).rotationX).toBeCloseTo(30);
  expect(transformAt(animated, 1.5).rotationY).toBeCloseTo(15);
  const edited = setKeyframeTransform(animated, { rotationY: 60 }, 2);
  expect(transformAt(edited, 0).rotationY).toBe(0);
  const snapshot = snapshotAnimation(edited, animationRanges(edited)[0]);
  expect(snapshot).toBeTruthy();
  const pasted = pasteAnimation(base, snapshot!, 5);
  expect(transformAt(pasted, 6).rotationX).toBe(60);
  expect(transformAt(pasted, 6).rotationY).toBe(60);
});

it("三轴投影与逆变换一致，侧面完全立起时不会产生无限大的拖动", () => {
  const value = {
    ...defaultTransform,
    rotationX: 45,
    rotationY: 35,
    rotation: 30,
  };
  const source = { x: 80, y: -30 };
  const result = localDelta(value, projectDelta(value, source));
  expect(result.x).toBeCloseTo(source.x);
  expect(result.y).toBeCloseTo(source.y);
  expect(localDelta({ ...value, rotationY: 90 }, source)).toEqual({
    x: 0,
    y: 0,
  });
});

it("首次编辑旋转起点不改变原终点，移动箭头保留省略角度的零值", () => {
  const motion = setTransform(base, { x: 0.7 }, 2, true);
  const initial = setKeyframeTransform(motion, { rotationX: 60 }, 1, true);
  expect(transformAt(initial, 1).rotationX).toBe(60);
  expect(transformAt(initial, 2).rotationX).toBe(0);
  const legacy = {
    ...base,
    keyframes: [
      { time: 0, value: { ...defaultTransform, rotationY: 60 } },
      { time: 1, value: defaultTransform },
    ],
  };
  const moved = retimeAnimation(
    legacy,
    animationRanges(legacy)[0],
    "move",
    1,
    30,
  );
  expect(transformAt(moved, 0).rotationY).toBe(60);
  expect(transformAt(moved, 2).rotationY).toBe(0);
  const hold = {
    ...legacy,
    transform: { ...defaultTransform, rotationY: 60 },
    keyframes: [
      { time: 0, value: { ...defaultTransform, rotationY: 60 } },
      { time: 1, value: defaultTransform },
    ],
  };
  expect(animationRanges(hold)).toHaveLength(0);
});
