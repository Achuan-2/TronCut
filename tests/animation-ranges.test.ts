import { describe, it, expect } from "vitest";
import { newText, defaultTransform, createProject } from "../shared/model";
import { animationRanges } from "../shared/animation-ranges";
import { splitClip } from "../shared/editor";

describe("时间线动画起止区间", () => {
  const value = (scale: number) => ({ ...defaultTransform, scale });
  it("无动画和单个起始关键帧不显示虚假的时长", () => {
    const clip = newText("titles", 0);
    expect(animationRanges(clip)).toEqual([]);
    clip.keyframes = [{ time: 0, value: value(1) }];
    expect(animationRanges(clip)).toEqual([]);
  });
  it("缺少显式起点时使用片段初始变换，按时间排序且不修改关键帧", () => {
    const clip = newText("titles", 10);
    clip.keyframes = [
      { time: 3, value: value(3) },
      { time: 1, value: value(2) },
    ];
    expect(animationRanges(clip)).toEqual([
      { start: 0, end: 1, hasStart: true, hasEnd: true },
      { start: 1, end: 3, hasStart: true, hasEnd: true },
    ]);
    expect(clip.keyframes[0].time).toBe(3);
  });
  it("保留两段动画之间的静止间隔，忽略零时长", () => {
    const clip = newText("titles", 0);
    clip.keyframes = [
      { time: 0, value: value(1) },
      { time: 1, value: value(2) },
      { time: 3, value: value(2) },
      { time: 3, value: value(2) },
      { time: 4, value: value(1) },
    ];
    expect(
      animationRanges(clip).map((range) => [range.start, range.end]),
    ).toEqual([
      [0, 1],
      [3, 4],
    ]);
  });
  it("裁切窗口中的动画保持区间，片段边界不会冒充真正的起止点", () => {
    const clip = newText("titles", 0);
    clip.duration = 2;
    clip.animationOffset = 1;
    clip.keyframes = [
      { time: 0, value: value(1) },
      { time: 4, value: value(2) },
    ];
    expect(animationRanges(clip)).toEqual([
      { start: 0, end: 2, hasStart: false, hasEnd: false },
    ]);
    clip.animationOffset = 5;
    expect(animationRanges(clip)).toEqual([]);
  });
  it("拆分动画后左右片段显示同一段动画各自保留的部分", () => {
    const project = createProject();
    const clip = newText("titles", 0);
    clip.keyframes = [
      { time: 0, value: value(1) },
      { time: 4, value: value(2) },
    ];
    project.clips = [clip];
    const split = splitClip(project, clip.id, 2);
    expect(animationRanges(split.clips[0])).toEqual([
      { start: 0, end: 2, hasStart: true, hasEnd: false },
    ]);
    expect(animationRanges(split.clips[1])).toEqual([
      { start: 0, end: 2, hasStart: false, hasEnd: true },
    ]);
  });
  it("透明度动画也显示起止箭头", () => {
    const clip = newText("titles", 0);
    clip.keyframes = [
      { time: 0, value: { ...value(1), opacity: 0 } },
      { time: 2, value: value(1) },
    ];
    expect(animationRanges(clip)).toHaveLength(1);
  });
});
