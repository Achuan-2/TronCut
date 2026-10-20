import { describe, expect, it } from "vitest";
import { createProject, newText, validateProject } from "../shared/model";
import {
  behaviorGlyphCount,
  behaviorFromPreset,
  mediaBehaviorPhase,
  mediaBehaviorStyles,
  type BehaviorPhaseKey,
  behaviorTransform,
  behaviorWindows,
  createBehavior,
  fitBehaviorDuration,
  glyphMotion,
  layoutGlyphs,
  supportsBehaviors,
  textGlyphs,
} from "../shared/behaviors";
import { frameSnapshot } from "../shared/frame-snapshot";
import { objectBehaviorExpressions } from "../electron/behavior-export";
import { behaviorPresets } from "../shared/behaviors";
import { splitClip } from "../shared/editor";
import { setClipSpeed } from "../shared/clip-speed";
import { createTransformSampler } from "../shared/editor";
import { libraryBehaviors, emptyPresetLibrary } from "../shared/preset-library";

describe("行为的对象与逐字时序", () => {
  it("浮现位于首位，复现丝滑版开场标题的上移、透明度与平滑时序", () => {
    expect(libraryBehaviors(emptyPresetLibrary())[0]).toMatchObject({
      id: "float",
      name: "浮现",
    });
    // Authored keyframes of “你的灵感，” in TronCut宣传片-v12-丝滑版.troncut.
    const title = newText("titles", 0, 0, "你的灵感，");
    title.duration = 4.6;
    title.style!.fontSize = 88;
    title.transform.y = 0.3592592592592593;
    title.keyframes = [
      {
        time: 0,
        value: {
          ...title.transform,
          y: title.transform.y + 34 / 1080,
          opacity: 0,
        },
        easing: "auto",
      },
      { time: 0.85, value: { ...title.transform }, easing: "auto" },
      { time: 4.15, value: { ...title.transform }, easing: "auto" },
      {
        time: 4.6,
        value: {
          ...title.transform,
          y: title.transform.y - 16 / 1080,
          opacity: 0,
        },
        easing: "auto",
      },
    ];
    const sample = createTransformSampler(title);
    const behavior = createBehavior("float", title.duration)!;
    for (const time of [
      0, 0.1, 0.2125, 0.425, 0.6375, 0.85, 2, 4.15, 4.2625, 4.375, 4.4875,
      4.599,
    ]) {
      const reference = sample(time);
      for (const index of [0, 2, 5]) {
        const motion = glyphMotion(
          { behaviors: [behavior] },
          time,
          index,
          6,
          "text",
        );
        expect(title.transform.y + (motion.y * 88) / 1080).toBeCloseTo(
          reference.y,
          10,
        );
        expect(motion.opacity).toBeCloseTo(reference.opacity, 10);
        expect(motion.x).toBe(0);
        expect(motion.scale).toBe(1);
        expect(motion.rotation).toBe(0);
      }
    }
    const short = createBehavior("float", 0.3)!;
    const windows = behaviorWindows(short, 6);
    expect(windows.incoming + windows.outgoing).toBeCloseTo(0.3);
    const restored = validateProject({
      ...createProject(),
      clips: [{ ...title, keyframes: [], behaviors: [behavior] }],
    });
    expect(restored.clips[0].behaviors![0]).toEqual(behavior);
  });
  it("切换为位移行为，默认参数区分视频与文本，张力与平移影响实际运动", () => {
    const video = createBehavior("cut", 5, "video")!;
    expect(video.incoming).toMatchObject({
      type: "whole",
      easing: "spring",
      tension: 9,
    });
    expect(video.during).toMatchObject({
      style: "cut",
      easing: "smoothstep",
      shift: 2,
      loopTime: 3,
      loopForever: true,
    });
    expect(video.outgoing).toMatchObject({
      easing: "quad-in",
      speed: 93,
    });
    const text = createBehavior("cut", 5, "text")!;
    expect(text.incoming).toMatchObject({ type: "center", offset: 0.02 });
    expect(text.during).toMatchObject({ type: "simultaneous", offset: 0 });
    expect(text.outgoing).toMatchObject({ type: "center", offset: 1 / 30 });
    const clip = { behaviors: [video] };
    const low = glyphMotion(clip, 0.2, 0, 1, "object");
    expect(Math.abs(low.y)).toBeGreaterThan(0.01);
    video.incoming.tension = 15;
    expect(glyphMotion(clip, 0.2, 0, 1, "object").y).not.toBeCloseTo(low.y);
    video.incoming.style = "none";
    video.outgoing.style = "none";
    const smallShift = glyphMotion(clip, 0.2, 0, 1, "object").y;
    video.during.shift = 20;
    expect(glyphMotion(clip, 0.2, 0, 1, "object").y).toBeCloseTo(
      smallShift * 10,
    );
    expect(glyphMotion(clip, 0.2, 0, 1, "object").opacity).toBe(1);
  });
  it("中心向外优先处理中间两个字，文本同时不会变为对象动画", () => {
    const behavior = createBehavior("cut", 5)!;
    behavior.incoming.offset = 0.2;
    const clip = { behaviors: [behavior] };
    expect(glyphMotion(clip, 0.1, 0, 4, "text").opacity).toBe(0);
    expect(glyphMotion(clip, 0.1, 1, 4, "text").opacity).toBeGreaterThan(0);
    expect(glyphMotion(clip, 0.1, 2, 4, "text").opacity).toBeGreaterThan(0);
    behavior.incoming.style = "none";
    behavior.outgoing.style = "none";
    expect(glyphMotion(clip, 0.2, 0, 4, "text")).toEqual(
      glyphMotion(clip, 0.2, 3, 4, "text"),
    );
    expect(glyphMotion(clip, 0.2, 0, 4, "object").x).toBe(0);
    const simultaneous = glyphMotion(clip, 0.2, 0, 4, "text");
    behavior.during.offset = 0.1;
    expect(glyphMotion(clip, 0.2, 0, 4, "text").y).not.toBeCloseTo(
      simultaneous.y,
    );
    expect(glyphMotion(clip, 0.2, 0, 4, "text")).toEqual(
      glyphMotion(clip, 0.2, 3, 4, "text"),
    );
  });
  it("视频变速与拆分使行为跟随各片段长度，不改动源内容", () => {
    const clip = {
      ...newText("video", 2),
      kind: "video" as const,
      assetId: "asset",
      behaviors: [createBehavior("slide", 5, "video")!],
    };
    const fast = setClipSpeed(clip, 2);
    expect(fast.behaviors![0].duration).toBe(2.5);
    const project = createProject();
    project.clips = [fast];
    const split = splitClip(project, fast.id, 3);
    expect(split.clips.map((value) => value.behaviors![0].duration)).toEqual([
      1, 1.5,
    ]);
    expect(split.clips[1].sourceIn).toBe(2);
    expect(clip.behaviors[0].duration).toBe(5);
  });
  it("期间阶段遵守强度、循环时间、循环间延迟和有限次数", () => {
    const clip = newText("titles", 0);
    const behavior = createBehavior("pulse", clip.duration, "image")!;
    behavior.incoming.style = "none";
    behavior.outgoing.style = "none";
    behavior.during = {
      ...behavior.during,
      easing: "linear",
      loopTime: 1,
      delay: 0.5,
      loops: 1,
      loopForever: false,
      intensity: 40,
    };
    clip.behaviors = [behavior];
    expect(glyphMotion(clip, 0.5, 0, 1, "object").scale).toBeCloseTo(1.4);
    expect(glyphMotion(clip, 1.2, 0, 1, "object").scale).toBe(1);
    expect(glyphMotion(clip, 1.75, 0, 1, "object").scale).toBe(1);
    behavior.during.loopForever = true;
    expect(glyphMotion(clip, 2, 0, 1, "object").scale).toBeCloseTo(1.4);
  });
  it("所有对象预设、缓动和循环参数的导出表达式与预览采样一致", () => {
    const math = {
      choose: (condition: number, a: number, b: number) => (condition ? a : b),
      clip: (v: number, min: number, max: number) =>
        Math.max(min, Math.min(max, v)),
      lt: (a: number, b: number) => Number(a < b),
      gt: (a: number, b: number) => Number(a > b),
      gte: (a: number, b: number) => Number(a >= b),
      lte: (a: number, b: number) => Number(a <= b),
      pow: Math.pow,
      max: Math.max,
      abs: Math.abs,
      sin: Math.sin,
      cos: Math.cos,
      exp: Math.exp,
      sqrt: Math.sqrt,
      mod: (a: number, b: number) => a % b,
    };
    const phaseCases = Object.entries(mediaBehaviorStyles).flatMap(
      ([key, styles]) =>
        styles.map(([style]) => ({
          id: `check-${key}-${style}`,
          name: style,
          category: "media" as const,
          incoming: mediaBehaviorPhase("none", "incoming"),
          during: mediaBehaviorPhase("none", "during"),
          outgoing: mediaBehaviorPhase("none", "outgoing"),
          [key]: mediaBehaviorPhase(style, key as BehaviorPhaseKey),
        })),
    );
    for (const preset of [...behaviorPresets, ...phaseCases])
      for (const easing of [
        "linear",
        "smoothstep",
        "quad-in",
        "quad-out",
        "quad-in-out",
        "spring",
        "bounce",
        "circular-out",
        "exponential-out",
        "back-out",
      ] as const) {
        const clip = { ...newText("titles", 2), kind: "image" as const };
        const behavior = behaviorFromPreset(preset, clip.duration, clip.kind);
        for (const key of ["incoming", "during", "outgoing"] as const)
          behavior[key].easing = easing;
        behavior.during.delay = 0.2;
        behavior.during.loops = 1;
        behavior.during.loopForever = false;
        clip.behaviors = [behavior];
        const expressions = objectBehaviorExpressions(clip, "t");
        for (const local of [
          0, 0.01, 0.2, 0.6, 0.8, 1.2, 1.8, 3, 4.6, 4.99, 5,
        ]) {
          const motion = glyphMotion(clip, local, 0, 1, "object");
          for (const key of Object.keys(
            expressions,
          ) as (keyof typeof expressions)[]) {
            const expression = expressions[key]
              .replace(/\bif\(/g, "choose(")
              .replace(/\bPI\b/g, "Math.PI");
            const evaluate = new Function(
              "t",
              "m",
              `const {choose,clip,lt,gt,gte,lte,pow,max,abs,sin,cos,mod,exp,sqrt}=m; return ${expression};`,
            );
            expect(
              evaluate(clip.start + local, math),
              `${preset.id}/${easing}/${local}/${key}`,
            ).toBeCloseTo(motion[key], 9);
          }
        }
      }
  });
  it("文字、图片、视频和形状可使用行为，音频不可使用", () => {
    for (const kind of ["text", "image", "video", "shape"] as const)
      expect(supportsBehaviors({ kind })).toBe(true);
    expect(supportsBehaviors({ kind: "audio" })).toBe(false);
  });
  it("按完整字符处理中文、组合字符和 emoji，并保留换行位置", () => {
    expect(textGlyphs("中e\u0301👨‍👩‍👧‍👦")).toHaveLength(3);
    const layout = layoutGlyphs("中A\nBC", 20, (text) => text.length * 12);
    expect(layout.count).toBe(4);
    expect(layout.glyphs[2].y).toBeGreaterThan(layout.glyphs[0].y);
    expect(behaviorGlyphCount({ kind: "text", text: "中A\nBC" })).toBe(4);
  });
  it("文字的顺序与对象模式独立，偏移按逐字处理且禁用恢复原状态", () => {
    const clip = newText("titles", 0, 0, "ABC");
    const behavior = createBehavior("type-reveal", clip.duration)!;
    behavior.incoming.offset = 0.2;
    behavior.outgoing.style = "none";
    clip.behaviors = [behavior];
    expect(glyphMotion(clip, 0.1, 0, 3, "text").opacity).toBeGreaterThan(0);
    expect(glyphMotion(clip, 0.1, 2, 3, "text").opacity).toBe(0);
    expect(glyphMotion(clip, 0.1, 2, 3, "object").opacity).toBe(1);
    behavior.incoming.type = "backward";
    expect(glyphMotion(clip, 0.1, 0, 3, "text").opacity).toBe(0);
    expect(glyphMotion(clip, 0.1, 2, 3, "text").opacity).toBeGreaterThan(0);
    behavior.enabled = false;
    expect(glyphMotion(clip, 0, 0, 3).opacity).toBe(1);
  });
  it("短片段压缩进出阶段，调整片段长度后行为覆盖全长", () => {
    const clip = newText("titles", 0);
    const behavior = createBehavior("type-fly", 0.1)!;
    const windows = behaviorWindows(behavior, 30);
    expect(windows.incoming + windows.outgoing).toBeCloseTo(0.1);
    const next = fitBehaviorDuration({
      ...clip,
      duration: 0.2,
      behaviors: [behavior],
    });
    expect(next.behaviors![0].duration).toBe(0.2);
    expect(next.behaviors![0].start).toBe(0);
  });
  it("项目校验保留参数，截帧冻结原行为时间而不重新开始", () => {
    const clip = newText("titles", 2, 0, "ABC");
    clip.behaviors = [createBehavior("type-fade", clip.duration)!];
    const project = createProject();
    project.clips = [clip];
    const restored = validateProject(JSON.parse(JSON.stringify(project)));
    expect(restored.clips[0].behaviors).toEqual(clip.behaviors);
    const snapshot = frameSnapshot(project, 2.3).clips[0];
    for (let index = 0; index < 3; index++)
      expect(glyphMotion(snapshot, 0, index, 3).opacity).toBeCloseTo(
        glyphMotion(clip, 0.3, index, 3).opacity,
        12,
      );
  });
  it("对象行为叠加在基础变换上，原有动画和参数不被改写", () => {
    const clip = newText("titles", 0);
    clip.behaviors = [
      createBehavior("slide", clip.duration, "image")!,
      createBehavior("pulse", clip.duration, "image")!,
    ];
    const before = JSON.stringify(clip);
    const value = behaviorTransform(clip, clip.transform, 0.2);
    expect(value.x).toBeLessThan(clip.transform.x);
    expect(value.scale).not.toBe(clip.transform.scale);
    expect(value.opacity).toBe(1);
    expect(JSON.stringify(clip)).toBe(before);
  });
});
