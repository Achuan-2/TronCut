import { describe, expect, it } from "vitest";
import { newText, createProject, validateProject } from "../shared/model";
import {
  behaviorFromPreset,
  behaviorTransform,
  behaviorWindows,
  changeBehaviorType,
  createBehavior,
  glyphMotion,
  mediaBehaviorPhase,
  mediaBehaviorPresets,
  mediaBehaviorStyles,
} from "../shared/behaviors";
import {
  captureBehaviorPreset,
  emptyPresetLibrary,
  libraryBehaviors,
  presetLibrarySchema,
} from "../shared/preset-library";

describe("媒体行为和文本的媒体模式", () => {
  it("提供十个独立预设，保留原项目阶段组合和精确时长", () => {
    expect(mediaBehaviorPresets.map((preset) => preset.name)).toEqual([
      "弹入",
      "漂移",
      "淡入",
      "飞入",
      "增长",
      "铰链",
      "内爆",
      "显示",
      "切换",
      "滑入",
    ]);
    expect(createBehavior("media-fade", 5, "image")).toMatchObject({
      incoming: { duration: 1317928960 / 705600000 },
      during: { style: "cut", loopTime: 3.17 },
      outgoing: { style: "drop" },
    });
    for (const preset of mediaBehaviorPresets) {
      const behavior = behaviorFromPreset(preset, 5, "text");
      for (const key of ["incoming", "during", "outgoing"] as const) {
        expect(behavior[key].type).toBe("whole");
        expect(behavior[key].offset).toBe(0);
      }
      const short = behaviorWindows({ ...behavior, duration: 0.1 }, 1);
      expect(short.incoming + short.outgoing).toBeLessThanOrEqual(0.100001);
    }
  });

  it("文本预设添加到媒体与从媒体标签添加产生相同阶段", () => {
    for (const [text, media] of [
      ["cut", "cut"],
      ["pop", "hinge"],
      ["drift", "drift"],
      ["fade", "fade"],
      ["fly", "fly"],
      ["scale", "grow"],
      ["explode", "implode"],
      ["reveal", "reveal"],
      ["slide", "slide"],
      ["bounce", "bounce-in"],
      ["type-fade", "fade"],
    ]) {
      for (const kind of ["image", "video"] as const) {
        const a = createBehavior(text, 5, kind)!;
        const b = createBehavior(`media-${media}`, 5, kind)!;
        for (const key of ["incoming", "during", "outgoing"] as const)
          expect(a[key], `${text}/${key}`).toEqual(b[key]);
      }
    }
  });

  it("文本切到媒体类型使用相同样式和参数，可切回逐字模式", () => {
    for (const [text, media] of [
      ["pop", "hinge"],
      ["scale", "grow"],
      ["explode", "implode"],
      ["cut", "cut"],
      ["fly", "fly"],
    ]) {
      const phase = createBehavior(text, 5)!.incoming;
      const converted = changeBehaviorType(phase, "incoming", "whole");
      expect(converted).toEqual(
        mediaBehaviorPhase(
          createBehavior(`media-${media}`, 5)!.incoming.style,
          "incoming",
        ),
      );
      expect(changeBehaviorType(converted, "incoming", "forward").type).toBe(
        "forward",
      );
    }
    expect(mediaBehaviorStyles.incoming.map(([, name]) => name)).toContain(
      "增长",
    );
    expect(mediaBehaviorStyles.outgoing.map(([, name]) => name)).toContain(
      "收缩",
    );
    expect(mediaBehaviorStyles.during.map(([, name]) => name)).not.toContain(
      "增长",
    );
  });

  it("增长、铰链、内爆、下降和收缩具有不同的运动通道", () => {
    const motion = (
      style: Parameters<typeof mediaBehaviorPhase>[0],
      key: "incoming" | "outgoing",
      progress: number,
    ) => {
      const b = createBehavior("media-cut", 5)!;
      b.incoming.style = b.during.style = b.outgoing.style = "none";
      b[key] = {
        ...mediaBehaviorPhase(style, key),
        duration: 1,
        easing: "linear",
      };
      return glyphMotion(
        { behaviors: [b] },
        key === "incoming" ? progress : 4 + progress,
        0,
        1,
        "object",
      );
    };
    expect(motion("grow", "incoming", 0.25).scale).toBeCloseTo(0.25);
    expect(motion("shrink", "outgoing", 0.25).scale).toBeCloseTo(0.75);
    expect(motion("drop", "outgoing", 0.5).y).toBeGreaterThan(1);
    const hinge = motion("hinge", "incoming", 0.5);
    expect(hinge.rotationX).toBeCloseTo(45);
    expect(hinge.pivotY).toBeGreaterThan(0);
    const implode = motion("implode", "incoming", 0.5);
    expect(implode.scale).toBe(2);
    expect(implode.rotationY).toBe(90);
    const clip = newText("titles", 0);
    clip.behaviors = [createBehavior("media-hinge", 5)!];
    const small = behaviorTransform(clip, clip.transform, 0.1, {
      width: 0.2,
      height: 0.2,
    });
    const large = behaviorTransform(clip, clip.transform, 0.1, {
      width: 0.4,
      height: 0.4,
    });
    expect(large.y - clip.transform.y).toBeCloseTo(
      2 * (small.y - clip.transform.y),
    );
  });

  it("媒体分类随自定义预设及项目保存，旧库仍可读取", () => {
    const behavior = createBehavior("media-implode", 5)!;
    const preset = captureBehaviorPreset(behavior, "我的内爆");
    const state = presetLibrarySchema.parse({
      ...emptyPresetLibrary(),
      customBehaviors: [preset],
    });
    expect(
      libraryBehaviors(state).find((value) => value.id === preset.id)?.category,
    ).toBe("media");
    const project = createProject();
    project.clips = [
      { ...newText(project.tracks[0].id, 0), behaviors: [behavior] },
    ];
    expect(
      validateProject(JSON.parse(JSON.stringify(project))).clips[0]
        .behaviors![0],
    ).toEqual(behavior);
    expect(presetLibrarySchema.safeParse({ version: 1 }).success).toBe(true);
  });
});
