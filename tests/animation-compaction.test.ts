import { describe, expect, it } from "vitest";
import { newText } from "../shared/model";
import {
  compactAnimationFrames,
  animationRanges,
} from "../shared/animation-ranges";
import { setTransform, transformAt } from "../shared/editor";
import {
  addAnimationKeyframe,
  removeAnimation,
} from "../shared/animation-edit";

describe("动画仅保留起止端点", () => {
  it("纯静止片段清空冗余帧，保留由首帧定义的初始状态", () => {
    const clip = newText("titles", 0);
    clip.keyframes = [0, 1, 3, 4].map((time) => ({
      time,
      value: { ...clip.transform, x: 0.7 },
    }));
    const compacted = compactAnimationFrames(clip);
    expect(compacted.keyframes).toEqual([]);
    expect(compacted.transform.x).toBe(0.7);
    for (const time of [0, 1, 2, 4.5])
      expect(transformAt(compacted, time)).toEqual(transformAt(clip, time));
    expect(compactAnimationFrames(compacted)).toBe(compacted);
  });
  it("静止空档不留游离帧，动画各自的起止及播放结果保持一致", () => {
    const clip = newText("titles", 0);
    clip.duration = 10;
    clip.keyframes = [
      [0, 0.5],
      [1, 0.5],
      [2, 0.7],
      [3, 0.7],
      [4, 0.7],
      [5, 0.7],
      [6, 0.9],
      [7, 0.9],
    ].map(([time, x]) => ({ time, value: { ...clip.transform, x } }));
    const compacted = compactAnimationFrames(clip);
    expect(compacted.keyframes.map((frame) => frame.time)).toEqual([
      1, 2, 5, 6,
    ]);
    expect(animationRanges(compacted)).toEqual(animationRanges(clip));
    for (let time = 0; time <= 9; time += 0.1)
      expect(transformAt(compacted, time)).toEqual(transformAt(clip, time));
    expect(compactAnimationFrames(compacted)).toBe(compacted);
  });
  it("明确添加的相同属性动画仍保留起止，删除后不残留静止帧", () => {
    const clip = addAnimationKeyframe(newText("titles", 0), 3, 30)!.clip;
    expect(compactAnimationFrames(clip)).toBe(clip);
    const removed = removeAnimation(clip, animationRanges(clip)[0]);
    expect(removed.keyframes).toEqual([]);
    expect(transformAt(removed, 4)).toEqual(clip.transform);
  });
  it("静止遗留帧不再缩短自动或手动创建的动画时长", () => {
    const clip = newText("titles", 0);
    clip.keyframes = [0, 1.2, 2.2, 2.3, 2.9, 3.9].map((time) => ({
      time,
      value: { ...clip.transform },
    }));
    const auto = setTransform(clip, { x: 0.8 }, 2.6, true);
    const manual = addAnimationKeyframe(clip, 2.6, 30)!.clip;
    for (const edited of [auto, manual]) {
      expect(edited.keyframes.map((frame) => frame.time)).toEqual([1.6, 2.6]);
      expect(edited.keyframes[1].animation).toBe(true);
    }
  });
  it("静态修改清除失去动画意义的旧帧，无变化的自动编辑不创建动画", () => {
    const clip = newText("titles", 0);
    clip.keyframes = [
      { time: 0, value: { ...clip.transform } },
      { time: 2, value: { ...clip.transform, x: 0.8 } },
    ];
    const staticEdit = setTransform(clip, { x: 0.6 }, 2, false);
    expect(staticEdit.keyframes).toEqual([]);
    expect(setTransform(staticEdit, { x: 0.6 }, 3, true)).toBe(staticEdit);
    expect(
      setTransform(newText("titles", 0), { x: 0.8 }, 0, true).keyframes,
    ).toEqual([]);
  });
  it("清理不裁掉时间线窗口之外的动画，不修改录屏路径及缩放平移采样", () => {
    const clip = setTransform(newText("titles", 0), { x: 0.8 }, 2, true);
    clip.animationOffset = 3;
    expect(compactAnimationFrames(clip)).toBe(clip);
    for (const extra of [
      { recordingZoom: true as const },
      { zoomPan: { x: 0.5, y: 0.5, scale: 1, opacity: 1 as const } },
    ]) {
      const sampled = {
        ...clip,
        keyframes: clip.keyframes.map((frame) => ({ ...frame, ...extra })),
      };
      expect(compactAnimationFrames(sampled)).toBe(sampled);
    }
  });
});
