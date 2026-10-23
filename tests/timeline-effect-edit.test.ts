import { describe, expect, it } from "vitest";
import {
  createProject,
  newText,
  validateProject,
  type Clip,
} from "../shared/model";
import { addMediaFrame } from "../shared/media-frame";
import {
  addVisualEffect,
  additionalVisualEffectPresets,
  defaultVisualEffect,
} from "../shared/visual-effects";
import {
  copyTimelineEffect,
  removeTimelineEffect,
  pasteTimelineEffect,
  pasteTimelineEffects,
} from "../shared/timeline-effect-edit";
import { effectWindow } from "../shared/effect-timing";
import { rangedVisualEffect } from "../shared/visual-effect-range";

function fixture(): Clip {
  return { ...newText("video", 0), kind: "image", duration: 4 };
}

describe("时间线效果移除与剪贴板", () => {
  it.each([
    "rounded-corners",
    ...additionalVisualEffectPresets.map((effect) => effect.id),
  ] as const)(
    "%s 复制参数及局部范围，粘贴只替换同类效果，移除不删除素材",
    (id) => {
      const source =
        id === "rounded-corners"
          ? addMediaFrame(fixture())
          : addVisualEffect(fixture(), id);
      const effect = rangedVisualEffect(source, id)!;
      effect.window = { start: 2, end: 4 };
      effect.timing = { offset: 1, duration: 5 };
      const copied = copyTimelineEffect(source, id)!;
      const target = { ...addVisualEffect(fixture(), "shadow"), duration: 8 };
      const beforeShadow = target.visualEffects!.shadow;
      const pasted = pasteTimelineEffect(target, copied);
      expect(pasted.id).toBe(target.id);
      expect(pasted.duration).toBe(8);
      expect(effectWindow(rangedVisualEffect(pasted, id)!, 8)).toEqual({
        start: 2,
        end: 6,
      });
      expect(rangedVisualEffect(pasted, id)!.timing).toBeUndefined();
      if (id !== "shadow")
        expect(pasted.visualEffects!.shadow).toBe(beforeShadow);
      const removed = removeTimelineEffect(pasted, id);
      expect(rangedVisualEffect(removed, id)).toBeUndefined();
      expect(removed.id).toBe(target.id);
      expect(removed.transform).toEqual(target.transform);
      expect(removed.keyframes).toEqual(target.keyframes);
      const project = createProject();
      project.assets = [
        {
          id: "image",
          name: "image.png",
          path: "image.png",
          kind: "image",
          width: 320,
          height: 180,
          duration: 0,
          hasAudio: false,
        },
      ];
      pasted.assetId = "image";
      project.clips = [pasted];
      expect(
        validateProject(JSON.parse(JSON.stringify(project))).clips[0],
      ).toEqual(pasted);
    },
  );

  it("遮罩复制当前可见参数，替换/移除清理旧遮罩动画，保留素材位置动画", () => {
    const source = addVisualEffect(fixture(), "mask");
    source.keyframes = [
      { time: 0, value: { ...source.transform, maskX: 0.2 } },
      { time: 2, value: { ...source.transform, maskX: 0.8 }, easing: "linear" },
    ];
    const copied = copyTimelineEffect(source, "mask", 1)!;
    const target = addVisualEffect(fixture(), "mask");
    target.keyframes = [
      { time: 0, value: { ...target.transform, x: 0.3, maskX: 0.1 } },
      { time: 2, value: { ...target.transform, x: 0.6, maskX: 0.9 } },
    ];
    const pasted = pasteTimelineEffect(target, copied);
    expect(pasted.visualEffects!.mask!.x).toBeCloseTo(0.5);
    expect(pasted.keyframes.map((frame) => frame.value.x)).toEqual([0.3, 0.6]);
    expect(
      pasted.keyframes.every((frame) => frame.value.maskX === undefined),
    ).toBe(true);
    const removed = removeTimelineEffect(target, "mask");
    expect(
      removed.keyframes.every((frame) => frame.value.maskX === undefined),
    ).toBe(true);
    expect(removed.keyframes.map((frame) => frame.value.x)).toEqual([0.3, 0.6]);
  });

  it("复制为独立快照，完整生效范围适配目标长度，音频拒绝视觉效果", () => {
    const source = addMediaFrame(fixture());
    const copied = copyTimelineEffect(source, "rounded-corners")!;
    source.mediaFrame!.radius = 80;
    const pasted = pasteTimelineEffect({ ...fixture(), duration: 2 }, copied);
    expect(pasted.mediaFrame!.radius).toBe(20);
    expect(effectWindow(pasted.mediaFrame!, 2)).toEqual({ start: 0, end: 2 });
    pasted.mediaFrame!.radius = 60;
    expect(pasteTimelineEffect(fixture(), copied).mediaFrame!.radius).toBe(20);
    const audio = { ...fixture(), kind: "audio" as const };
    expect(pasteTimelineEffect(audio, copied)).toBe(audio);
    expect(copyTimelineEffect(fixture(), "mask")).toBeNull();
    expect(
      removeTimelineEffect(fixture(), "mask").visualEffects,
    ).toBeUndefined();
  });

  it("多选一并粘贴，包含锁定轨道时拒绝整步修改", () => {
    const project = createProject();
    project.tracks.push({
      id: "locked",
      name: "锁定",
      hidden: false,
      muted: false,
      locked: true,
    });
    project.clips = [
      fixture(),
      { ...fixture(), id: "second" },
      { ...fixture(), id: "locked-clip", trackId: "locked" },
    ];
    const copied = copyTimelineEffect(
      { ...fixture(), visualEffects: { tint: defaultVisualEffect("tint") } },
      "tint",
    )!;
    const ids = project.clips.slice(0, 2).map((clip) => clip.id);
    const next = pasteTimelineEffects(project, ids, copied);
    expect(
      next.clips.slice(0, 2).every((clip) => !!clip.visualEffects?.tint),
    ).toBe(true);
    expect(next.clips[2]).toBe(project.clips[2]);
    expect(pasteTimelineEffects(project, [...ids, "locked-clip"], copied)).toBe(
      project,
    );
  });

  it("剪辑速度复制/移除保留目标源区间，不能粘贴到图片", () => {
    const source = {
      ...fixture(),
      kind: "video" as const,
      speed: 2,
      speedEffect: true,
    };
    const copied = copyTimelineEffect(source, "clip-speed")!;
    const target = {
      ...fixture(),
      kind: "video" as const,
      duration: 8,
      sourceIn: 3,
    };
    const pasted = pasteTimelineEffect(target, copied);
    expect(pasted).toMatchObject({ speed: 2, duration: 4, sourceIn: 3 });
    expect(removeTimelineEffect(pasted, "clip-speed")).toMatchObject({
      speed: 1,
      duration: 8,
      sourceIn: 3,
    });
    const image = fixture();
    expect(pasteTimelineEffect(image, copied)).toBe(image);
  });
});
