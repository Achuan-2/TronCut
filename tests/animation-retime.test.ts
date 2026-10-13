import { describe, it, expect } from "vitest";
import {
  newText,
  defaultTransform,
  validateProject,
  createProject,
} from "../shared/model";
import { animationRanges, retimeAnimation } from "../shared/animation-ranges";
import { transformAt } from "../shared/editor";

function animated() {
  const clip = newText("titles", 10);
  clip.duration = 6;
  clip.keyframes = [
    { time: 0, value: { ...defaultTransform } },
    { time: 2, value: { ...defaultTransform, scale: 2 } },
  ];
  return clip;
}

describe("直接拖动动画时间", () => {
  it("拖开始只修改起点，原片段的位置、时长和关键帧值不变", () => {
    const clip = animated();
    const next = retimeAnimation(
      clip,
      animationRanges(clip)[0],
      "start",
      1,
      30,
    );
    expect(next.keyframes.map((frame) => frame.time)).toEqual([1, 2]);
    expect(next.keyframes.map((frame) => frame.value)).toEqual(
      clip.keyframes.map((frame) => frame.value),
    );
    expect(next.start).toBe(10);
    expect(next.duration).toBe(6);
    expect(clip.keyframes[0].time).toBe(0);
    expect(transformAt(next, 0.5).scale).toBe(1);
    expect(transformAt(next, 1.5).scale).toBeCloseTo(1.5);
  });
  it("拖结束改变动画时长，至少保留一帧", () => {
    const clip = animated();
    const next = retimeAnimation(clip, animationRanges(clip)[0], "end", 1, 30);
    expect(next.keyframes.map((frame) => frame.time)).toEqual([0, 3]);
    const short = retimeAnimation(
      clip,
      animationRanges(clip)[0],
      "end",
      -100,
      30,
    );
    expect(short.keyframes[1].time).toBeCloseTo(1 / 30);
  });
  it("整体移动保持原动画时长，按帧对齐位移且不移出片段", () => {
    const clip = animated();
    const moved = retimeAnimation(
      clip,
      animationRanges(clip)[0],
      "move",
      1.01,
      30,
    );
    expect(moved.keyframes.map((frame) => frame.time)).toEqual([1, 3]);
    const bounded = retimeAnimation(
      clip,
      animationRanges(clip)[0],
      "move",
      100,
      30,
    );
    expect(bounded.keyframes.map((frame) => frame.time)).toEqual([4, 6]);
    expect(transformAt(bounded, 3).scale).toBe(1);
    expect(transformAt(bounded, 6).scale).toBe(2);
  });
  it("不能穿过相邻关键帧，移动后关键帧顺序保持有效", () => {
    const clip = animated();
    clip.keyframes.push(
      { time: 4, value: { ...defaultTransform, scale: 2 } },
      { time: 5, value: { ...defaultTransform, scale: 3 } },
    );
    const range = animationRanges(clip)[1];
    const moved = retimeAnimation(clip, range, "move", -10, 30);
    expect(moved.keyframes[2].time).toBeCloseTo(2 + 1 / 30);
    expect(moved.keyframes[3].time - moved.keyframes[2].time).toBeCloseTo(1);
    expect(moved.keyframes[1]).toEqual(clip.keyframes[1]);
    expect(
      validateProject({ ...createProject(), clips: [moved] }).clips[0],
    ).toEqual(moved);
  });
  it("裁切后的关键帧仍用源动画时间，拖动可见终点不会修改被裁掉的起点", () => {
    const clip = animated();
    clip.animationOffset = 1;
    clip.duration = 4;
    const range = animationRanges(clip)[0];
    expect(range.hasStart).toBe(false);
    expect(retimeAnimation(clip, range, "start", 1, 30)).toBe(clip);
    const next = retimeAnimation(clip, range, "end", 1, 30);
    expect(next.keyframes.map((frame) => frame.time)).toEqual([0, 3]);
    expect(animationRanges(next)[0].end).toBe(2);
  });
  it("没有显式零时刻关键帧时仍可调整开始", () => {
    const clip = animated();
    clip.keyframes.shift();
    const next = retimeAnimation(
      clip,
      animationRanges(clip)[0],
      "start",
      1,
      30,
    );
    expect(next.keyframes.map((frame) => frame.time)).toEqual([1, 2]);
    expect(transformAt(next, 0).scale).toBe(1);
  });
  it("移动起始状态不同于静态变换的动画时，不凭空多出一段动画", () => {
    const clip = animated();
    clip.keyframes[0].value.opacity = 0;
    const next = retimeAnimation(clip, animationRanges(clip)[0], "move", 1, 30);
    expect(animationRanges(next)).toHaveLength(1);
    expect(next.transform.opacity).toBe(0);
    expect(transformAt(next, 0.5).opacity).toBe(0);
  });
  it("点击、无效位移和达到边界时不生成无意义的编辑", () => {
    const clip = animated();
    const range = animationRanges(clip)[0];
    expect(retimeAnimation(clip, range, "move", 0, 30)).toBe(clip);
    expect(retimeAnimation(clip, range, "move", -1, 30)).toBe(clip);
    expect(retimeAnimation(clip, range, "move", NaN, 30)).toBe(clip);
  });
});
