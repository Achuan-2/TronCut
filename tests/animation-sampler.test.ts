import { describe, expect, it } from "vitest";
import {
  createTransformSampler,
  splitClip,
  transformAt,
} from "../shared/editor";
import { createProject, defaultTransform, newText } from "../shared/model";
import { animationEasings, easeProgress } from "../shared/easing";

describe("预处理关键帧采样", () => {
  it("隐含零时刻、重复时间和倒序拖动保持原来的端点语义", () => {
    const clip = newText("video", 0);
    clip.keyframes = [
      { time: 2, value: { ...defaultTransform, x: 2 }, easing: "linear" },
      { time: 1, value: { ...defaultTransform, x: 1 }, easing: "linear" },
      { time: 1, value: { ...defaultTransform, x: 3 }, easing: "linear" },
    ];
    const sample = createTransformSampler(clip);
    for (const [time, x] of [
      [3, 2],
      [1.5, 2.5],
      [1, 1],
      [0.5, 0.75],
      [-1, 0.5],
      [2, 2],
    ]) {
      expect(sample(time).x).toBeCloseTo(x);
    }
    expect(clip.keyframes.map((frame) => frame.time)).toEqual([2, 1, 1]);
  });

  it("五种缓动、旋转与裁切在缓存采样中保留约束", () => {
    for (const easing of animationEasings) {
      const clip = newText("video", 0);
      clip.rotation = 30;
      clip.keyframes = [
        { time: 0, value: { ...defaultTransform, rotationY: 0, cropLeft: 0 } },
        {
          time: 2,
          value: {
            ...defaultTransform,
            x: 1,
            opacity: 0,
            rotationY: 60,
            cropLeft: 0.9,
          },
          easing,
        },
      ];
      const sample = createTransformSampler(clip);
      for (const time of [0, 0.2, 0.75, 1, 1.9, 2, 4]) {
        const progress = easeProgress(Math.min(1, time / 2), easing);
        const value = sample(time);
        expect(value.x).toBeCloseTo(0.5 + 0.5 * progress);
        expect(value.rotation).toBe(30);
        expect(value.rotationY).toBeCloseTo(60 * progress);
        expect(value.opacity).toBeCloseTo(
          Math.max(0, Math.min(1, 1 - progress)),
        );
        expect(value.cropLeft).toBeGreaterThanOrEqual(0);
        expect(value.cropLeft).toBeLessThanOrEqual(0.95);
        expect(value.cropLeft! + value.cropRight!).toBeLessThanOrEqual(0.98);
      }
    }
  });

  it("拆分后的动画偏移与新的预处理快照保持一致", () => {
    const project = createProject();
    const clip = newText("video", 0);
    clip.keyframes = [
      { time: 0, value: defaultTransform },
      { time: 4, value: { ...defaultTransform, scale: 3 } },
    ];
    project.clips = [clip];
    const source = createTransformSampler(clip);
    const split = splitClip(project, clip.id, 2);
    const right = split.clips.find((part) => part.start === 2)!;
    const sample = createTransformSampler(right);
    for (const time of [0, 0.25, 1, 2])
      expect(sample(time)).toEqual(source(time + 2));
    const changed = {
      ...clip,
      keyframes: [{ time: 0, value: { ...defaultTransform, scale: 2 } }],
    };
    expect(createTransformSampler(changed)(1).scale).toBe(2);
    expect(source(0).scale).toBe(1);
  });

  it("即时 transformAt 仍能读取调用方就地修改的输入，输出不共享可变对象", () => {
    const clip = newText("video", 0);
    expect(transformAt(clip, 0).x).toBe(0.5);
    clip.transform.x = 0.2;
    clip.keyframes.push({ time: 1, value: { ...defaultTransform, x: 1 } });
    expect(transformAt(clip, 0).x).toBe(0.2);
    expect(transformAt(clip, 1).x).toBe(1);
    const sample = createTransformSampler(clip);
    sample(1).x = 9;
    expect(sample(1).x).toBe(1);
  });
});
