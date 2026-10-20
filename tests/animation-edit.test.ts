import { describe, expect, it } from "vitest";
import { createProject, newText, validateProject } from "../shared/model";
import { setTransform, transformAt, changeSpeed } from "../shared/editor";
import { animationRanges, retimeAnimation } from "../shared/animation-ranges";
import {
  pasteAnimation,
  removeAnimation,
  setAnimationEasing,
  snapshotAnimation,
} from "../shared/animation-edit";
import { animationEasings, easeProgress } from "../shared/easing";

function twoAnimations() {
  const clip = newText("titles", 0);
  clip.duration = 8;
  return setTransform(
    setTransform(clip, { x: 0.7 }, 2, true),
    { x: 0.9 },
    5,
    true,
  );
}

describe("动画菜单编辑", () => {
  it("删除一段动画保留片段、后续动画和静止间隔", () => {
    const clip = twoAnimations();
    const removed = removeAnimation(clip, animationRanges(clip)[0]);
    expect(removed.id).toBe(clip.id);
    expect(removed.duration).toBe(8);
    expect(
      animationRanges(removed).map(({ start, end }) => [start, end]),
    ).toEqual([[4, 5]]);
    expect(transformAt(removed, 3).x).toBe(0.5);
    expect(transformAt(removed, 5).x).toBe(0.9);
    expect(clip.keyframes[1].value.x).toBe(0.7);
  });
  it("复制及粘贴保留时长和缓动，运动相对目标状态，不创建连接动画", () => {
    const original = twoAnimations();
    const source = setAnimationEasing(
      original,
      animationRanges(original)[0],
      "bounce",
    );
    const copied = snapshotAnimation(source, animationRanges(source)[0])!;
    const pasted = pasteAnimation(source, copied, 6);
    expect(
      animationRanges(pasted).map(({ start, end }) => [start, end]),
    ).toEqual([
      [1, 2],
      [4, 5],
      [6, 7],
    ]);
    expect(transformAt(pasted, 5.5).x).toBe(0.9);
    expect(transformAt(pasted, 7).x).toBeCloseTo(1.1);
    expect(pasted.keyframes.at(-1)?.easing).toBe("bounce");
    expect(
      snapshotAnimation(pasted, animationRanges(pasted)[2])?.duration,
    ).toBe(1);
  });
  it("剪切后可在同一位置粘回，拒绝越界和覆盖已有动画", () => {
    const clip = twoAnimations();
    const range = animationRanges(clip)[0];
    const copied = snapshotAnimation(clip, range)!;
    const cut = removeAnimation(clip, range);
    const pasted = pasteAnimation(cut, copied, 1);
    expect(transformAt(pasted, 2).x).toBeCloseTo(0.7);
    expect(animationRanges(pasted)).toEqual(animationRanges(clip));
    expect(pasteAnimation(clip, copied, 1.5)).toBe(clip);
    expect(pasteAnimation(clip, copied, 7.5)).toBe(clip);
  });
  it("缓动修改仅作用于选中段，保存校验、变速和拖动保留设置", () => {
    const clip = twoAnimations();
    const range = animationRanges(clip)[1];
    const eased = setAnimationEasing(clip, range, "linear");
    const p = createProject();
    p.clips = [eased];
    expect(
      validateProject(JSON.parse(JSON.stringify(p))).clips[0].keyframes.at(-1)
        ?.easing,
    ).toBe("linear");
    expect(changeSpeed(eased, 2).keyframes.at(-1)?.easing).toBe("linear");
    expect(
      retimeAnimation(eased, range, "move", 1, 30).keyframes.at(-1)?.easing,
    ).toBe("linear");
    expect(transformAt(eased, 1.25).x).toBeCloseTo(transformAt(clip, 1.25).x);
    expect(transformAt(eased, 4.25).x).toBeCloseTo(0.75);
    expect(transformAt(clip, 4.25).x).toBeCloseTo(0.73125);
  });
  it("旧项目自动缓动保持原曲线，各模式起止精确且中途有区别", () => {
    for (const easing of animationEasings) {
      expect(easeProgress(0, easing)).toBe(0);
      expect(easeProgress(1, easing)).toBe(1);
    }
    expect(easeProgress(0.25)).toBe(0.15625);
    expect(easeProgress(0.25, "linear")).toBe(0.25);
    expect(easeProgress(0.25, "exponential")).toBeLessThan(0.05);
    expect(easeProgress(0.75, "spring")).toBeGreaterThan(1);
    expect(easeProgress(0.5, "bounce")).toBeGreaterThan(0.7);
  });
});
