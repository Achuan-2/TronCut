import { describe, expect, it } from "vitest";
import { createProject, newText, validateProject } from "../shared/model";
import {
  addAnimationKeyframe,
  removeAnimation,
  snapshotAnimation,
  pasteAnimation,
} from "../shared/animation-edit";
import { animationRanges, retimeAnimation } from "../shared/animation-ranges";
import { setKeyframeTransform, transformAt } from "../shared/editor";

describe("手动添加动画关键帧", () => {
  it("相同起止属性也显示一秒箭头，修改终点后只改变动画结束状态", () => {
    const clip = newText("titles", 0);
    const result = addAnimationKeyframe(clip, 3, 30)!;
    expect(
      animationRanges(result.clip).map(({ start, end }) => [start, end]),
    ).toEqual([[2, 3]]);
    expect(transformAt(result.clip, 2.5)).toEqual(clip.transform);
    const edited = setKeyframeTransform(result.clip, { x: 0.8 }, 3);
    expect(transformAt(edited, 2).x).toBe(0.5);
    expect(transformAt(edited, 2.5).x).toBeCloseTo(0.65);
    expect(transformAt(edited, 3).x).toBe(0.8);
  });
  it("开头添加时使用向后一秒，短片段和裁切片段不越界，同一终点不重复创建", () => {
    const clip = newText("titles", 0);
    clip.duration = 0.5;
    const result = addAnimationKeyframe(clip, 0, 30)!;
    expect(result.time).toBe(0.5);
    expect(animationRanges(result.clip)[0].end).toBe(0.5);
    expect(addAnimationKeyframe(result.clip, 0.5, 30)?.clip).toBe(result.clip);
    clip.animationOffset = 2;
    expect(
      addAnimationKeyframe(clip, 0.4, 30)!.clip.keyframes.map(
        (frame) => frame.time,
      ),
    ).toEqual([2, 2.4]);
    expect(addAnimationKeyframe(clip, 1, 30)).toBeNull();
    expect(addAnimationKeyframe({ ...clip, kind: "audio" }, 0, 30)).toBeNull();
  });
  it("第二段箭头保持独立，修改前一终点不改下一终点，删除不影响其他占位动画", () => {
    const first = addAnimationKeyframe(newText("titles", 0), 2, 30)!.clip;
    const second = addAnimationKeyframe(first, 5, 30)!.clip;
    const edited = setKeyframeTransform(second, { x: 0.8 }, 2);
    expect(
      animationRanges(edited).map(({ start, end }) => [start, end]),
    ).toEqual([
      [1, 2],
      [4, 5],
    ]);
    expect(transformAt(edited, 3).x).toBe(0.8);
    expect(transformAt(edited, 5).x).toBe(0.5);
    const removed = removeAnimation(second, animationRanges(second)[0]);
    expect(
      animationRanges(removed).map(({ start, end }) => [start, end]),
    ).toEqual([[4, 5]]);
  });
  it("相连占位箭头可拖开，复制、保存重开仍显示占位区间", () => {
    const first = addAnimationKeyframe(newText("titles", 0), 1, 30)!.clip;
    const second = addAnimationKeyframe(first, 2, 30)!.clip;
    const moved = retimeAnimation(
      second,
      animationRanges(second)[1],
      "start",
      0.5,
      30,
    );
    expect(
      animationRanges(moved).map(({ start, end }) => [start, end]),
    ).toEqual([
      [0, 1],
      [1.5, 2],
    ]);
    const copied = snapshotAnimation(first, animationRanges(first)[0])!;
    const pasted = pasteAnimation(first, copied, 3);
    expect(
      animationRanges(pasted).map(({ start, end }) => [start, end]),
    ).toEqual([
      [0, 1],
      [3, 4],
    ]);
    const project = createProject();
    project.clips = [pasted];
    expect(
      animationRanges(
        validateProject(JSON.parse(JSON.stringify(project))).clips[0],
      ),
    ).toEqual(animationRanges(pasted));
  });
});
