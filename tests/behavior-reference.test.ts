import { describe, expect, it } from "vitest";
import {
  behaviorPresets,
  behaviorSchema,
  behaviorWindows,
  changeBehaviorPhase,
  clipsBehaviorText,
  createBehavior,
  glyphMotion,
  phaseSeconds,
} from "../shared/behaviors";

describe("用户 Camtasia 行为项目的参考时序与运动特征", () => {
  it("保留参考项目按 editRate 换算的时长、逐字间隔与阶段组合", () => {
    const cut = createBehavior("cut", 5)!;
    expect(phaseSeconds(cut.incoming)).toBeCloseTo(1070160000 / 705600000, 10);
    expect(phaseSeconds(cut.outgoing)).toBeCloseTo(305760000 / 705600000, 10);
    expect(cut.outgoing.offset).toBeCloseTo(23520000 / 705600000, 10);
    expect(cut.during.loopTime).toBe(3.17);
    const pop = createBehavior("pop", 5)!;
    expect(phaseSeconds(pop.incoming)).toBe(2.45);
    expect(pop.incoming.tension).toBe(5);
    expect(pop.during.rotation).toBeCloseTo(16);
    expect(createBehavior("type-scatter", 5)!.outgoing.style).toBe("explode");
    expect(createBehavior("type-fade", 5)!.during.style).toBe("pop");
    expect(createBehavior("pulse", 5)!.during.intensity).toBeCloseTo(8);
    expect(createBehavior("sway", 5)!.incoming.style).toBe("none");
    expect(createBehavior("shake", 5)!.outgoing.style).toBe("none");
  });

  it("切换逐字上下交错并受文本框裁切，对象从上方进入且不叠加渐变", () => {
    const text = { behaviors: [createBehavior("cut", 5)!] };
    const a = glyphMotion(text, 0.1, 0, 3, "text");
    const b = glyphMotion(text, 0.1, 1, 3, "text");
    expect(a.x).toBe(0);
    expect(a.y * b.y).toBeLessThan(0);
    expect(a.opacity).toBe(1);
    expect(b.opacity).toBe(1);
    expect(clipsBehaviorText(text, 0.1, 3)).toBe(true);
    const object = { behaviors: [createBehavior("cut", 5, "image")!] };
    const initial = glyphMotion(object, 0.02, 0, 1, "object");
    expect(initial.y).toBeLessThan(-10);
    expect(initial.opacity).toBe(1);
    // The curated media preset accelerates out near the end of the clip.
    expect(glyphMotion(object, 4.99, 0, 1, "object").y).toBeLessThan(-10);
    expect(clipsBehaviorText(object, 0.1, 1)).toBe(false);
  });

  it("弹出绕边缘翻起，飞入从大尺寸收敛，爆炸沿不同方向翻转散开", () => {
    const pop = createBehavior("pop", 5)!;
    const hinged = glyphMotion({ behaviors: [pop] }, 0.1, 0, 3, "text");
    expect(hinged.rotationX).toBeGreaterThan(0);
    expect(hinged.scale).toBe(1);
    const during = behaviorWindows(pop, 3).incoming + 0.5;
    expect(
      glyphMotion({ behaviors: [pop] }, during, 0, 3, "text").rotationX,
    ).toBeCloseTo(16);
    const fly = { behaviors: [createBehavior("fly", 5)!] };
    expect(glyphMotion(fly, 0.05, 0, 3, "text").scale).toBeGreaterThan(10);
    expect(glyphMotion(fly, 2, 0, 3, "text").scale).toBe(1);
    const explode = { behaviors: [createBehavior("explode", 5)!] };
    const first = glyphMotion(explode, 4.7, 0, 3, "text");
    const second = glyphMotion(explode, 4.7, 1, 3, "text");
    expect(first.y * second.y).toBeLessThan(0);
    expect(Math.abs(first.rotationY)).toBeGreaterThan(30);
    expect(first.opacity).toBe(1);
  });

  it("摆动与颤动使用可重复的双轴运动，调整频率确实改变轨迹", () => {
    for (const id of ["sway", "shake"]) {
      const behavior = createBehavior(id, 5)!;
      const clip = { behaviors: [behavior] };
      const original = glyphMotion(clip, 1.25, 0, 3, "text");
      expect(original.x).not.toBe(0);
      expect(original.y).not.toBe(0);
      expect(glyphMotion(clip, 1.25, 0, 3, "text")).toEqual(original);
      behavior.during.frequency *= 2;
      expect(glyphMotion(clip, 1.25, 0, 3, "text")).not.toEqual(original);
    }
  });

  it("速度和张力编辑会更新精确时长，旧项目可补齐新增字段", () => {
    const original = createBehavior("cut", 5)!;
    const faster = changeBehaviorPhase(original.outgoing, { speed: 97 });
    expect(phaseSeconds(faster)).toBeLessThan(phaseSeconds(original.outgoing));
    const tighter = changeBehaviorPhase(original.incoming, { tension: 14 });
    expect(phaseSeconds(tighter)).toBeCloseTo(
      phaseSeconds(original.incoming) / 2,
    );
    for (const preset of behaviorPresets) {
      const behavior = createBehavior(preset.id, 5)!;
      expect(behaviorSchema.safeParse(behavior).success, preset.id).toBe(true);
      for (const key of ["incoming", "during", "outgoing"] as const) {
        const legacy = { ...behavior[key] };
        for (const field of [
          "duration",
          "rotation",
          "horizontal",
          "vertical",
          "frequency",
        ] as const)
          delete (legacy as Partial<typeof legacy>)[field];
        expect(
          behaviorSchema.safeParse({ ...behavior, [key]: legacy }).success,
        ).toBe(true);
      }
    }
  });
});
