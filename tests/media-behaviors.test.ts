import { describe, expect, it } from "vitest";
import { newText, createProject, validateProject } from "../shared/model";
import {
  behaviorFromPreset,
  behaviorEase,
  behaviorTransform,
  behaviorWindows,
  changeBehaviorType,
  createBehavior,
  glyphMotion,
  mediaBehaviorPhase,
  mediaBehaviorPresets,
  mediaBehaviorStyles,
  phaseSeconds,
} from "../shared/behaviors";
import {
  captureBehaviorPreset,
  emptyPresetLibrary,
  libraryBehaviors,
  presetLibrarySchema,
} from "../shared/preset-library";

describe("媒体行为和文本的媒体模式", () => {
  it("提供十个独立预设，按动作风格搭配进、期间和出并留足展示时间", () => {
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
      incoming: { style: "fade", duration: 1317928960 / 705600000 },
      during: { style: "none" },
      outgoing: { style: "fade", duration: 0.65 },
    });
    const combinations = [
      ["bounce-in", "pulse", "shrink"],
      ["drift", "drift", "drift"],
      ["fade", "none", "fade"],
      ["fly", "none", "fly"],
      ["grow", "pulse", "shrink"],
      ["hinge", "none", "hinge"],
      ["implode", "none", "explode"],
      ["reveal", "none", "reveal"],
      ["cut", "cut", "cut"],
      ["slide", "none", "slide"],
    ];
    expect(
      mediaBehaviorPresets.map((preset) => [
        preset.incoming.style,
        preset.during.style,
        preset.outgoing.style,
      ]),
    ).toEqual(combinations);
    for (const preset of mediaBehaviorPresets) {
      const behavior = behaviorFromPreset(preset, 5, "text");
      for (const key of ["incoming", "during", "outgoing"] as const) {
        expect(behavior[key].type).toBe("whole");
        expect(behavior[key].offset).toBe(0);
      }
      const short = behaviorWindows({ ...behavior, duration: 0.1 }, 1);
      expect(short.incoming + short.outgoing).toBeLessThanOrEqual(0.100001);
      const windows = behaviorWindows(behavior, 1);
      // Even the longest entry leaves two seconds for presentation on a 5s clip.
      expect(windows.incoming + windows.outgoing).toBeLessThanOrEqual(3);
      if (behavior.during.style === "pulse")
        expect(behavior.during.intensity).toBeLessThanOrEqual(3);
      if (behavior.during.style === "drift")
        expect(behavior.during.rotation).toBeLessThanOrEqual(2);
    }
  });

  it("按参考的秒级节奏进场，弹簧保留回摆且结束时没有明显视觉跳变", () => {
    for (const preset of mediaBehaviorPresets) {
      expect(phaseSeconds(preset.incoming), preset.id).toBeGreaterThanOrEqual(
        0.8,
      );
      expect(phaseSeconds(preset.incoming), preset.id).toBeLessThanOrEqual(2.1);
    }
    for (const id of ["grow", "hinge", "cut"]) {
      const behavior = createBehavior(`media-${id}`, 5)!;
      const phase = behavior.incoming;
      expect(phase.springDuration).toBeGreaterThanOrEqual(1);
      for (const progress of [0.1, 0.25, 0.5, 0.75, 0.99]) {
        const motion = glyphMotion(
          { behaviors: [behavior] },
          progress * phaseSeconds(phase),
          0,
          1,
          "object",
        );
        const q = behaviorEase(
          progress,
          "spring",
          phase.tension,
          phase.springDuration,
        );
        if (id === "grow")
          expect(motion.scale).toBeCloseTo(Math.max(0.01, q), 10);
        if (id === "hinge")
          expect(motion.rotationX).toBeCloseTo(90 * (1 - q), 10);
        if (id === "cut") expect(motion.y).toBeCloseTo(-12.5 * (1 - q), 10);
        if (progress === 0.99) {
          expect(Math.abs(motion.scale - 1)).toBeLessThan(0.03);
          // Orthographic hinge rotation changes projected height by cos(angle).
          expect(1 - Math.cos((motion.rotationX * Math.PI) / 180)).toBeLessThan(
            0.015,
          );
          expect(Math.abs(motion.pivotY)).toBeLessThan(0.008);
          expect(Math.abs(motion.y)).toBeLessThan(0.15);
        }
      }
    }
  });

  it("显示的位移先缓动到位，透明度按参考时间线性增长", () => {
    const behavior = createBehavior("media-reveal", 5)!;
    const duration = phaseSeconds(behavior.incoming);
    expect(duration).toBeCloseTo(2899443712 / 3 / 705600000, 10);
    for (const progress of [0.25, 0.5, 0.75]) {
      const motion = glyphMotion(
        { behaviors: [behavior] },
        duration * progress,
        0,
        1,
        "object",
      );
      expect(motion.opacity).toBeCloseTo(progress, 10);
      expect(motion.pivotX).toBeCloseTo(-0.08 * (1 - progress) ** 4, 10);
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

  it("媒体显示在进出时同时移动并渐变，四个方向按素材尺寸计算", () => {
    for (const direction of ["left", "right", "top", "bottom"] as const) {
      const horizontal = direction === "left" || direction === "right";
      const sign = direction === "left" || direction === "top" ? -1 : 1;
      const behavior = createBehavior("media-reveal", 4)!;
      for (const key of ["incoming", "outgoing"] as const)
        behavior[key] = {
          ...behavior[key],
          direction,
          duration: 1,
          easing: "linear",
        };
      const clip = {
        ...newText("titles", 0),
        duration: 4,
        behaviors: [behavior],
      };
      clip.transform.scale = 0.5;
      for (const [time, opacity, hidden] of [
        [0.25, 0.25, 0.75],
        [0.75, 0.75, 0.25],
        [3.25, 0.75, 0.25],
        [3.75, 0.25, 0.75],
      ]) {
        const pose = behaviorTransform(clip, clip.transform, time, {
          width: 0.4,
          height: 0.6,
        });
        expect(pose.opacity).toBeCloseTo(opacity);
        expect(pose.x - clip.transform.x).toBeCloseTo(
          horizontal ? sign * 0.08 * hidden * 0.4 * 0.5 : 0,
        );
        expect(pose.y - clip.transform.y).toBeCloseTo(
          horizontal ? 0 : sign * 0.08 * hidden * 0.6 * 0.5,
        );
        expect(pose.scale).toBe(clip.transform.scale);
      }
      const midway = glyphMotion(clip, 2, 0, 1, "object");
      expect(midway.pivotX).toBe(0);
      expect(midway.pivotY).toBe(0);
      expect(midway.opacity).toBe(1);
    }
    const text = createBehavior("reveal", 4)!;
    expect(glyphMotion({ behaviors: [text] }, 0.1, 0, 1, "text").pivotX).toBe(
      0,
    );
  });

  it("期间的显示沿所选方向轻移淡出并返回，方向不会成为无效设置", () => {
    for (const direction of ["left", "right", "top", "bottom"] as const) {
      const behavior = createBehavior("media-reveal", 4)!;
      behavior.incoming.style = behavior.outgoing.style = "none";
      behavior.during = {
        ...mediaBehaviorPhase("reveal", "during"),
        direction,
        easing: "linear",
        loopTime: 1,
        intensity: 20,
      };
      const mid = glyphMotion({ behaviors: [behavior] }, 0.5, 0, 1, "object");
      const sign = ["left", "top"].includes(direction) ? -1 : 1;
      expect(mid.opacity).toBeCloseTo(0.8);
      expect(mid.pivotX).toBeCloseTo(
        ["left", "right"].includes(direction) ? sign * 0.2 : 0,
      );
      expect(mid.pivotY).toBeCloseTo(
        ["top", "bottom"].includes(direction) ? sign * 0.2 : 0,
      );
      const end = glyphMotion({ behaviors: [behavior] }, 1, 0, 1, "object");
      expect(end.opacity).toBe(1);
      expect(end.pivotX).toBe(0);
      expect(end.pivotY).toBe(0);
    }
  });

  it("媒体分类随自定义预设及项目保存，旧库仍可读取", () => {
    const behavior = createBehavior("media-grow", 5)!;
    const preset = captureBehaviorPreset(behavior, "我的增长");
    const state = presetLibrarySchema.parse({
      ...emptyPresetLibrary(),
      customBehaviors: [preset],
    });
    expect(
      libraryBehaviors(state).find((value) => value.id === preset.id)?.category,
    ).toBe("media");
    expect(state.customBehaviors[0].incoming.springDuration).toBe(2);
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

  it("读取已有项目和自定义预设时保留用户保存的旧进场时钟", () => {
    const behavior = createBehavior("media-grow", 5)!;
    behavior.incoming.duration = 0.4;
    behavior.incoming.springDuration = 0.9;
    const project = createProject();
    project.clips = [
      { ...newText(project.tracks[0].id, 0), behaviors: [behavior] },
    ];
    expect(
      validateProject(JSON.parse(JSON.stringify(project))).clips[0]
        .behaviors![0].incoming,
    ).toEqual(behavior.incoming);
    const state = presetLibrarySchema.parse({
      ...emptyPresetLibrary(),
      customBehaviors: [captureBehaviorPreset(behavior, "旧时钟")],
    });
    expect(state.customBehaviors[0].incoming).toEqual(behavior.incoming);
  });
});
