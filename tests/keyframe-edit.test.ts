import { describe, expect, it } from "vitest";
import {
  newText,
  defaultTransform,
  createProject,
  validateProject,
} from "../shared/model";
import {
  setKeyframeTransform,
  setTransform,
  transformAt,
} from "../shared/editor";
import {
  animationRanges,
  animationEditTarget,
  retimeAnimation,
} from "../shared/animation-ranges";

function animated() {
  const clip = newText("titles", 0);
  clip.keyframes = [
    { time: 0, value: { ...defaultTransform, x: 0.2 } },
    { time: 2, value: { ...defaultTransform, x: 0.4 } },
    { time: 4, value: { ...defaultTransform, x: 0.6 } },
  ];
  return clip;
}
describe("明确选择动画关键帧后编辑", () => {
  it("修改终点只改变选中帧，起点、下一段和静态变换保持原值", () => {
    const clip = animated();
    const edited = setKeyframeTransform(
      clip,
      { x: 0.8, scale: 2, opacity: 0.5 },
      2,
    );
    expect(edited.transform).toEqual(clip.transform);
    expect(edited.keyframes[0]).toBe(clip.keyframes[0]);
    expect(edited.keyframes[2]).toBe(clip.keyframes[2]);
    expect(transformAt(edited, 0).x).toBe(0.2);
    expect(transformAt(edited, 2)).toMatchObject({
      x: 0.8,
      scale: 2,
      opacity: 0.5,
    });
    expect(transformAt(edited, 1).x).toBeCloseTo(0.5);
  });
  it("修改起点不会同步修改动画终点", () => {
    const clip = animated();
    const edited = setKeyframeTransform(clip, { x: 0.1 }, 0);
    expect(transformAt(edited, 0).x).toBe(0.1);
    expect(transformAt(edited, 2).x).toBe(0.4);
  });
  it("裁切后按源动画时间准确选中关键帧，不创建邻近的新帧", () => {
    const clip = animated();
    clip.animationOffset = 1;
    const edited = setKeyframeTransform(clip, { y: 0.8 }, 2);
    expect(edited.keyframes.map((frame) => frame.time)).toEqual([0, 2, 4]);
    expect(transformAt(edited, 1).y).toBe(0.8);
    expect(transformAt(edited, 3).y).toBe(0.5);
  });
  it("隐式起点可编辑，更新初始属性并保留终点", () => {
    const clip = animated();
    clip.keyframes.shift();
    const edited = setKeyframeTransform(clip, { x: 0.1 }, 0);
    expect(edited.keyframes.map((frame) => frame.time)).toEqual([0, 2, 4]);
    expect(edited.transform.x).toBe(0.1);
    expect(edited.keyframes[1]).toBe(clip.keyframes[0]);
  });
  it("失效的关键帧选择不会误改整个片段，也不删除时间很近的其他帧", () => {
    const clip = animated();
    expect(setKeyframeTransform(clip, { x: 0.8 }, 3)).toBe(clip);
    clip.keyframes.push({ time: 2.0001, value: defaultTransform });
    const edited = setKeyframeTransform(clip, { x: 0.8 }, 2);
    expect(edited.keyframes[3]).toBe(clip.keyframes[3]);
  });
  it("旋转只作用于选中帧，兼容旧片段旋转并平滑插值", () => {
    const clip = animated();
    clip.rotation = 10;
    const edited = setKeyframeTransform(clip, { rotation: 90 }, 2);
    expect(transformAt(edited, 0).rotation).toBe(10);
    expect(transformAt(edited, 1).rotation).toBe(50);
    expect(transformAt(edited, 2).rotation).toBe(90);
    expect(
      validateProject({ ...createProject(), clips: [edited] }).clips[0],
    ).toEqual(edited);
    const rotating = {
      ...clip,
      keyframes: [
        { time: 0, value: defaultTransform },
        { time: 2, value: { ...defaultTransform, rotation: 90 } },
      ],
    };
    expect(animationRanges(rotating)).toHaveLength(1);
  });
  it("自动动画默认一秒，在两次调整之间保持静止", () => {
    const first = setTransform(newText("titles", 0), { x: 0.7 }, 2, true);
    const second = setTransform(first, { x: 0.9 }, 5, true);
    expect(
      animationRanges(second).map(({ start, end }) => [start, end]),
    ).toEqual([
      [1, 2],
      [4, 5],
    ]);
    expect(transformAt(second, 3).x).toBe(0.7);
    expect(transformAt(second, 4).x).toBe(0.7);
    expect(transformAt(second, 4.5).x).toBeCloseTo(0.8);
  });
  it("在遗留静止关键帧之间自动移动后保持终点，不生成返回动画", () => {
    const clip = newText("titles", 0);
    clip.keyframes = [0, 1.2, 2.2, 2.3, 2.9, 3.9].map((time) => ({
      time,
      value: { ...clip.transform },
    }));
    const moved = setTransform(clip, { x: 0.8, y: 0.6 }, 2.6, true);
    expect(
      animationRanges(moved).map(({ start, end }) => [start, end]),
    ).toEqual([[1.6, 2.6]]);
    expect(moved.keyframes.map((frame) => frame.time)).toEqual([1.6, 2.6]);
    expect(transformAt(moved, 2.1).x).toBeCloseTo(0.65);
    for (const time of [2.6, 2.75, 2.9, 3.5, 4.5])
      expect(transformAt(moved, time)).toMatchObject({ x: 0.8, y: 0.6 });
    const adjusted = setTransform(moved, { x: 0.9 }, 2.6, true);
    expect(animationRanges(adjusted)).toHaveLength(1);
    expect(transformAt(adjusted, 4.5).x).toBe(0.9);
    expect(clip.keyframes.every((frame) => frame.value.x === 0.5)).toBe(true);
  });
  it.each([false, true])(
    "自动动画同步后续静止区间，同时保留未来动画（占位：%s）",
    (placeholder) => {
      const clip = newText("titles", 0);
      clip.duration = 8;
      clip.keyframes = [
        { time: 0, value: { ...clip.transform } },
        { time: 4, value: { ...clip.transform } },
        {
          time: 5,
          value: { ...clip.transform, x: placeholder ? 0.5 : 0.2 },
          ...(placeholder ? { animation: true as const } : {}),
        },
        { time: 6, value: { ...clip.transform } },
      ];
      clip.animationOffset = 0.5;
      const moved = setTransform(clip, { x: 0.8 }, 2, true);
      expect(
        animationRanges(moved).map(({ start, end }) => [start, end]),
      ).toEqual(
        placeholder
          ? [
              [1, 2],
              [3.5, 4.5],
            ]
          : [
              [1, 2],
              [3.5, 4.5],
              [4.5, 5.5],
            ],
      );
      expect(transformAt(moved, 3).x).toBe(0.8);
      expect(transformAt(moved, 3.5).x).toBe(0.8);
      expect(moved.keyframes.find((frame) => frame.time === 5)).toEqual(
        clip.keyframes[2],
      );
      if (!placeholder)
        expect(moved.keyframes.at(-1)).toEqual(clip.keyframes[3]);
      expect(transformAt(moved, 4.5).x).toBeCloseTo(placeholder ? 0.5 : 0.2);
    },
  );
  it("第一个动画起点修改初始属性，不新增开头动画", () => {
    const base = setTransform(newText("titles", 0), { x: 0.5 }, 0, true);
    const clip = setTransform(base, { x: 0.8 }, 2, true);
    const target = animationEditTarget(clip, 1, "start");
    const edited = setKeyframeTransform(clip, { x: 0.2 }, target.time, true);
    expect(edited.transform.x).toBe(0.2);
    expect(transformAt(edited, 0.5).x).toBe(0.2);
    expect(
      animationRanges(edited).map(({ start, end }) => [start, end]),
    ).toEqual([[1, 2]]);
  });
  it("后一个动画的起点编辑前一个终点，并同步静止间隔", () => {
    const first = setTransform(newText("titles", 0), { x: 0.7 }, 2, true);
    const clip = setTransform(first, { x: 0.9 }, 5, true);
    const target = animationEditTarget(clip, 4, "start");
    expect(target).toEqual({ time: 2, side: "end" });
    const edited = setKeyframeTransform(clip, { x: 0.6 }, target.time);
    expect(transformAt(edited, 3).x).toBe(0.6);
    expect(transformAt(edited, 4).x).toBe(0.6);
    expect(transformAt(edited, 5).x).toBe(0.9);
    expect(
      animationRanges(edited).map(({ start, end }) => [start, end]),
    ).toEqual([
      [1, 2],
      [4, 5],
    ]);
  });
  it("共享端点的旧动画可拖开，保留前一段动画及静止间隔", () => {
    const clip = animated();
    const edited = retimeAnimation(
      clip,
      animationRanges(clip)[1],
      "start",
      1,
      30,
    );
    expect(
      animationRanges(edited).map(({ start, end }) => [start, end]),
    ).toEqual([
      [0, 2],
      [3, 4],
    ]);
    expect(transformAt(edited, 2.5).x).toBe(0.4);
    const shortened = retimeAnimation(
      clip,
      animationRanges(clip)[0],
      "end",
      -1,
      30,
    );
    expect(
      animationRanges(shortened).map(({ start, end }) => [start, end]),
    ).toEqual([
      [0, 1],
      [2, 4],
    ]);
  });
});
