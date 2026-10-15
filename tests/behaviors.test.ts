import { describe, expect, it } from "vitest";
import { createProject, newText, validateProject } from "../shared/model";
import {
  behaviorGlyphCount,
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

describe("行为的对象与逐字时序", () => {
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
    const behavior = createBehavior("pulse", clip.duration)!;
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
    expect(glyphMotion(clip, 0.25, 0, 1, "object").scale).toBeCloseTo(1.4);
    expect(glyphMotion(clip, 1.2, 0, 1, "object").scale).toBe(1);
    expect(glyphMotion(clip, 1.75, 0, 1, "object").scale).toBe(1);
    behavior.during.loopForever = true;
    expect(glyphMotion(clip, 1.75, 0, 1, "object").scale).toBeCloseTo(1.4);
  });
  it("所有对象预设、缓动和循环参数的导出表达式与预览采样一致", () => {
    const math = {
      choose: (condition: number, a: number, b: number) => (condition ? a : b),
      clip: (v: number, min: number, max: number) =>
        Math.max(min, Math.min(max, v)),
      lt: (a: number, b: number) => Number(a < b),
      gt: (a: number, b: number) => Number(a > b),
      gte: (a: number, b: number) => Number(a >= b),
      pow: Math.pow,
      max: Math.max,
      abs: Math.abs,
      sin: Math.sin,
      cos: Math.cos,
      mod: (a: number, b: number) => a % b,
    };
    for (const preset of behaviorPresets)
      for (const easing of [
        "linear",
        "quad-in",
        "quad-out",
        "quad-in-out",
        "spring",
        "bounce",
      ] as const) {
        const clip = { ...newText("titles", 2), kind: "image" as const };
        const behavior = createBehavior(preset.id, clip.duration, clip.kind)!;
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
              `const {choose,clip,lt,gt,gte,pow,max,abs,sin,cos,mod}=m; return ${expression};`,
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
    expect(glyphMotion(clip, 0.1, 0, 3, "text").opacity).toBe(1);
    expect(glyphMotion(clip, 0.1, 2, 3, "text").opacity).toBe(0);
    expect(glyphMotion(clip, 0.1, 2, 3, "object").opacity).toBe(1);
    behavior.incoming.type = "backward";
    expect(glyphMotion(clip, 0.1, 0, 3, "text").opacity).toBe(0);
    expect(glyphMotion(clip, 0.1, 2, 3, "text").opacity).toBe(1);
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
  it("工程校验保留参数，截帧冻结原行为时间而不重新开始", () => {
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
      createBehavior("slide", clip.duration)!,
      createBehavior("pulse", clip.duration)!,
    ];
    const before = JSON.stringify(clip);
    const value = behaviorTransform(clip, clip.transform, 0.2);
    expect(value.x).toBeLessThan(clip.transform.x);
    expect(value.opacity).toBeLessThan(1);
    expect(JSON.stringify(clip)).toBe(before);
  });
});
