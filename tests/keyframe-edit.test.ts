import { describe, expect, it } from "vitest";
import {
  newText,
  defaultTransform,
  createProject,
  validateProject,
} from "../shared/model";
import { setKeyframeTransform, transformAt } from "../shared/editor";
import { animationRanges } from "../shared/animation-ranges";

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
  it("隐式起点可编辑，终点与静态初始数据仍保留", () => {
    const clip = animated();
    clip.keyframes.shift();
    const edited = setKeyframeTransform(clip, { x: 0.1 }, 0);
    expect(edited.keyframes.map((frame) => frame.time)).toEqual([0, 2, 4]);
    expect(edited.transform.x).toBe(0.5);
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
});
