import { describe, expect, it } from "vitest";
import { createProject, newText, validateProject } from "../shared/model";
import { setAllAnimationTransforms } from "../shared/animation-properties";
import { transformAt } from "../shared/editor";
import { animationRanges } from "../shared/animation-ranges";
import { animateContent } from "../shared/crop-animation";
import { animateMask } from "../shared/mask-animation";
import { defaultVisualEffect } from "../shared/visual-effects";

function fixture() {
  const clip = newText("titles", 0);
  clip.duration = 6;
  clip.keyframes = [
    { time: 0, value: { ...clip.transform, x: 0.2, scale: 1 } },
    {
      time: 2,
      value: { ...clip.transform, x: 0.6, scale: 2 },
      animation: true as const,
      easing: "linear" as const,
    },
    { time: 3, value: { ...clip.transform, x: 0.6, scale: 2 } },
    {
      time: 4,
      value: { ...clip.transform, x: 0.4, scale: 1 },
      animation: true as const,
    },
  ];
  return clip;
}

describe("编辑所有动画的素材属性", () => {
  it("以当前采样值平移、同比缩放所有状态，保留动画时序、缓动和静止区间", () => {
    const clip = fixture();
    const next = setAllAnimationTransforms(
      clip,
      { x: 0.7, scale: 3, rotation: 30 },
      1,
    );
    expect(next.transform.x).toBeCloseTo(0.8);
    expect(next.keyframes.map(({ value, ...frame }) => frame)).toEqual(
      clip.keyframes.map(({ value, ...frame }) => frame),
    );
    expect(animationRanges(next)).toEqual(animationRanges(clip));
    for (const time of [0, 0.5, 1, 2, 2.5, 3, 3.5, 4, 5]) {
      const before = transformAt(clip, time),
        after = transformAt(next, time);
      expect(after.x).toBeCloseTo(before.x + 0.3);
      expect(after.scale).toBeCloseTo(before.scale * 2);
      expect(after.rotation).toBe(30);
    }
    expect(clip.keyframes[0].value.scale).toBe(1);
  });

  it("裁切片段按源动画时间取参照，隐式旋转与独立缩放不会丢失", () => {
    const clip = fixture();
    clip.animationOffset = 1;
    clip.rotation = 15;
    const next = setAllAnimationTransforms(
      clip,
      { x: 0.7, rotation: 45, scaleX: 1.5 },
      0,
    );
    expect(transformAt(next, 0).x).toBeCloseTo(0.7);
    expect(transformAt(next, 0)).toMatchObject({
      rotation: 45,
      scaleX: 1.5,
    });
    expect(next.keyframes.map((frame) => frame.time)).toEqual([0, 2, 3, 4]);
    expect(next.animationOffset).toBe(1);
  });

  it("不修改无变化的输入；极值保持可保存且不删除动画端点", () => {
    const clip = fixture();
    expect(setAllAnimationTransforms(clip, { x: 0.6 }, 2)).toBe(clip);
    const next = setAllAnimationTransforms(
      clip,
      { scale: 8, opacity: 0, rotation: 3600 },
      0,
    );
    expect(next.keyframes).toHaveLength(clip.keyframes.length);
    expect(
      validateProject({ ...createProject(), clips: [next] }).clips[0],
    ).toEqual(next);
  });

  it("框内缩放的所有动画模式优先于选中端点和自动动画", () => {
    const clip = { ...fixture(), kind: "image" as const };
    clip.keyframes = clip.keyframes.map((frame, index) => ({
      ...frame,
      value: { ...frame.value, contentScale: index === 0 ? 1 : 2 },
    }));
    const next = animateContent(
      clip,
      { scale: 3 },
      {
        time: 2,
        auto: true,
        endpoint: { time: 2, side: "end" },
        all: true,
      },
    );
    expect(next.keyframes.map((frame) => frame.value.contentScale)).toEqual([
      1.5, 3, 3, 3,
    ]);
    expect(next.keyframes.map((frame) => frame.time)).toEqual([0, 2, 3, 4]);
  });

  it("遮罩整体调整同步所有状态，同时保留素材位置动画", () => {
    const clip = {
      ...fixture(),
      visualEffects: { mask: defaultVisualEffect("mask") },
    };
    clip.keyframes = clip.keyframes.map((frame, index) => ({
      ...frame,
      value: { ...frame.value, maskX: index === 0 ? 0.2 : 0.6 },
    }));
    const next = animateMask(
      clip,
      { x: 0.7 },
      {
        time: 2,
        auto: true,
        endpoint: { time: 2, side: "end" },
        all: true,
      },
    );
    expect(next.keyframes[0].value.maskX).toBeCloseTo(0.3);
    expect(next.keyframes[1].value.maskX).toBeCloseTo(0.7);
    expect(next.keyframes.map((frame) => frame.value.x)).toEqual(
      clip.keyframes.map((frame) => frame.value.x),
    );
  });
});
