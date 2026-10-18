import { describe, expect, it } from "vitest";
import {
  createProject,
  newText,
  projectSchema,
  type Clip,
} from "../shared/model";
import { pasteClipProperties } from "../shared/canvas-actions";
import { transformAt } from "../shared/editor";
import { defaultEffects } from "../shared/effects";
import { defaultVisualEffect } from "../shared/visual-effects";
import { visualValues } from "../shared/visual-state";
import { maskValues } from "../shared/mask-state";
import {
  normalizeRotationAxes,
  optionalTransformKeys,
} from "../shared/rotation";

function expectSamePose(after: Clip, before: Clip, time: number) {
  const sample = (clip: Clip) => {
    const value = transformAt(clip, time);
    return {
      ...normalizeRotationAxes(clip, value, optionalTransformKeys),
      ...visualValues(clip, value),
      ...maskValues(clip, value),
    };
  };
  const actual = sample(after);
  for (const [key, value] of Object.entries(sample(before)))
    expect(actual[key as keyof typeof actual]).toBeCloseTo(value, 10);
}

function fixture() {
  const project = createProject();
  const source = newText("titles", 0, 0, "来源");
  source.transform = { ...source.transform, x: 0.8, scale: 0.7, opacity: 0.4 };
  source.rotation = 45;
  source.crop = { left: 0.2, top: 0.1, right: 0, bottom: 0 };
  source.contentTransform = { x: 0.1, y: -0.1, scale: 2 };
  source.style!.color = "#123456";
  source.volume = 0.2;
  const target = newText("video", 0, 0, "目标");
  target.volume = 0.8;
  target.crop = { left: 0.05, top: 0, right: 0.1, bottom: 0 };
  target.effects = { ...defaultEffects, blur: 3 };
  target.keyframes = [
    { time: 0, value: { ...target.transform, x: 0.2 } },
    { time: 2, value: { ...target.transform, x: 0.4 } },
    { time: 4, value: { ...target.transform, x: 0.6 } },
  ];
  const other = newText("audio", 0, 0, "其他选中片段");
  project.clips = [source, target, other];
  return { project, source, target, other };
}

describe("属性粘贴遵循选中的动画端点", () => {
  it("终点粘贴只写该关键帧，不覆盖静态属性、其他动画或多选对象", () => {
    const { project, source, target, other } = fixture();
    const next = pasteClipProperties(project, [target.id, other.id], source, {
      clipId: target.id,
      time: 2,
      side: "end",
    });
    const pasted = next.clips[1];
    expect(pasted.transform).toBe(target.transform);
    expect(pasted.keyframes[0]).toBe(target.keyframes[0]);
    expect(pasted.keyframes[2]).toBe(target.keyframes[2]);
    expect(pasted.style).toBe(target.style);
    expect(pasted.effects).toBe(target.effects);
    expect(pasted.crop).toBe(target.crop);
    expect(pasted.volume).toBe(0.8);
    expect(pasted.text).toBe("目标");
    expect(next.clips[2]).toBe(other);
    expect(transformAt(pasted, 2)).toMatchObject({
      x: 0.8,
      scale: 0.7,
      opacity: 0.4,
      rotation: 45,
      contentScale: 2,
      contentX: 0.1,
      cropLeft: 0.2,
    });
    expectSamePose(pasted, target, 0);
    expectSamePose(pasted, target, 4);
    expect(projectSchema.safeParse(next).success).toBe(true);
  });

  for (const implicit of [false, true]) {
    it(`${implicit ? "隐式" : "显式"}起点粘贴保留其他端点原来的裁剪、框内变换和遮罩`, () => {
      const { project, source, target } = fixture();
      target.visualEffects = {
        mask: { ...defaultVisualEffect("mask"), x: 0.3, width: 0.4 },
      };
      source.visualEffects = {
        mask: { ...defaultVisualEffect("mask"), x: 0.8, width: 0.7 },
      };
      if (implicit) target.keyframes.shift();
      const pasted = pasteClipProperties(project, [target.id], source, {
        clipId: target.id,
        time: 0,
        side: "start",
      }).clips[1];
      expect(transformAt(pasted, 0)).toMatchObject({
        x: 0.8,
        scale: 0.7,
        cropLeft: 0.2,
        contentScale: 2,
        maskX: 0.8,
      });
      expectSamePose(pasted, target, 2);
      expect(pasted.visualEffects).toBe(target.visualEffects);
      expect(pasted.style).toBe(target.style);
      expect(pasted.volume).toBe(target.volume);
      expect(pasted.keyframes.map((frame) => frame.time)).toEqual([0, 2, 4]);
      expect(
        projectSchema.safeParse({ ...project, clips: [pasted] }).success,
      ).toBe(true);
    });
  }

  it("裁剪后按存储的动画时间写入，后一个动画起点沿用前一个终点的静止状态", () => {
    const { project, source, target } = fixture();
    target.animationOffset = 1;
    target.keyframes.splice(2, 0, {
      time: 3,
      value: { ...target.keyframes[1].value },
    });
    const pasted = pasteClipProperties(project, [target.id], source, {
      clipId: target.id,
      time: 2,
      side: "end",
    }).clips[1];
    expect(pasted.keyframes.map((frame) => frame.time)).toEqual([0, 2, 3, 4]);
    expect(transformAt(pasted, 1).scale).toBe(0.7);
    expect(transformAt(pasted, 2).scale).toBe(0.7);
    expectSamePose(pasted, target, 3);
  });

  it("失效、未选中和锁定端点不会退回整段粘贴", () => {
    const { project, source, target, other } = fixture();
    expect(
      pasteClipProperties(project, [target.id], source, {
        clipId: target.id,
        time: 1,
        side: "end",
      }),
    ).toBe(project);
    expect(
      pasteClipProperties(project, [other.id], source, {
        clipId: target.id,
        time: 2,
        side: "end",
      }),
    ).toBe(project);
    project.tracks.find((track) => track.id === target.trackId)!.locked = true;
    expect(
      pasteClipProperties(project, [target.id, other.id], source, {
        clipId: target.id,
        time: 2,
        side: "end",
      }),
    ).toBe(project);
  });
});
