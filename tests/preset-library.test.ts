import { describe, expect, it } from "vitest";
import {
  behaviorFromPreset,
  behaviorPresets,
  createBehavior,
  glyphMotion,
} from "../shared/behaviors";
import { createProject, newText, validateProject } from "../shared/model";
import {
  captureBehaviorPreset,
  deleteBehaviorPreset,
  emptyPresetLibrary,
  favoriteKey,
  libraryBehaviors,
  presetLibrarySchema,
  renameBehaviorPreset,
  restoreDefaultBehaviors,
} from "../shared/preset-library";

describe("本机预设库", () => {
  it("保存三个阶段的修改，复用到不同对象时不携带原效果的时间位置或开关", () => {
    const original = createBehavior("cut", 8)!;
    original.start = 2;
    original.enabled = false;
    original.incoming.speed = 88;
    original.incoming.offset = 0.05;
    original.during.loops = 4;
    original.during.loopForever = false;
    original.outgoing.tension = 9.5;
    const preset = captureBehaviorPreset(original, "  我的切换  ");
    expect(preset.name).toBe("我的切换");
    expect(preset.id).toMatch(/^user-/);
    const text = behaviorFromPreset(preset, 5);
    expect(text).toMatchObject({
      start: 0,
      duration: 5,
      enabled: true,
      incoming: { speed: 88, offset: 0.05 },
      during: { loops: 4, loopForever: false },
      outgoing: { tension: 9.5 },
    });
    const image = behaviorFromPreset(preset, 3, "image");
    expect(image.duration).toBe(3);
    for (const phase of [image.incoming, image.during, image.outgoing])
      expect(phase).toMatchObject({ type: "whole", offset: 0 });
    expect(image.outgoing.tension).toBe(9.5);
    original.incoming.speed = 30;
    text.during.loops = 9;
    expect(preset.incoming.speed).toBe(88);
    expect(preset.during.loops).toBe(4);
  });

  it("恢复被隐藏的默认行为，保留用户预设、改名和各类收藏", () => {
    const custom = captureBehaviorPreset(
      createBehavior("fade", 5)!,
      "我的淡入",
    );
    const state = {
      ...emptyPresetLibrary(),
      customBehaviors: [custom],
      favorites: [
        favoriteKey("behavior", custom.id),
        favoriteKey("animation", "fade"),
      ],
      behaviorNames: { fade: "改名的默认行为" },
    };
    const deleted = deleteBehaviorPreset(state, "fade");
    expect(
      libraryBehaviors(deleted).some((preset) => preset.id === "fade"),
    ).toBe(false);
    const restored = restoreDefaultBehaviors(deleted);
    expect(libraryBehaviors(restored)).toHaveLength(behaviorPresets.length + 1);
    expect(restored.customBehaviors).toEqual(state.customBehaviors);
    expect(restored.favorites).toEqual(state.favorites);
    expect(
      libraryBehaviors(restored).find((preset) => preset.id === "fade")?.name,
    ).toBe("改名的默认行为");
    const removedCustom = restoreDefaultBehaviors(
      deleteBehaviorPreset(restored, custom.id),
    );
    expect(removedCustom.customBehaviors).toEqual([]);
    expect(removedCustom.favorites).toEqual([favoriteKey("animation", "fade")]);
  });

  it("相同 ID 的行为和动画分开收藏，删除行为不会移除动画收藏", () => {
    const state = {
      ...emptyPresetLibrary(),
      favorites: [
        favoriteKey("behavior", "fade"),
        favoriteKey("animation", "fade"),
        favoriteKey("effect", "clip-speed"),
      ],
    };
    expect(deleteBehaviorPreset(state, "fade").favorites).toEqual([
      "animation:fade",
      "effect:clip-speed",
    ]);
  });

  it("重命名内置和自定义预设不会修改原始默认预设", () => {
    const custom = captureBehaviorPreset(
      createBehavior("fade", 5)!,
      "用户预设",
    );
    const state = { ...emptyPresetLibrary(), customBehaviors: [custom] };
    const renamed = renameBehaviorPreset(
      renameBehaviorPreset(state, "fade", "默认改名"),
      custom.id,
      " 自定义改名 ",
    );
    expect(
      libraryBehaviors(renamed).find((preset) => preset.id === "fade")?.name,
    ).toBe("默认改名");
    expect(renamed.customBehaviors[0].name).toBe("自定义改名");
    expect(behaviorPresets.find((preset) => preset.id === "fade")?.name).toBe(
      "淡入淡出",
    );
    expect(custom.name).toBe("用户预设");
  });

  it("持久化格式保留全部参数，拒绝损坏的阶段和重复 ID", () => {
    const custom = captureBehaviorPreset(createBehavior("pop", 5)!, "弹出");
    const state = {
      ...emptyPresetLibrary(),
      customBehaviors: [custom],
      hiddenBehaviors: ["fade"],
      favorites: [favoriteKey("behavior", custom.id)],
    };
    expect(
      presetLibrarySchema.parse(JSON.parse(JSON.stringify(state))),
    ).toEqual(state);
    expect(
      presetLibrarySchema.safeParse({
        ...state,
        customBehaviors: [custom, custom],
      }).success,
    ).toBe(false);
    expect(
      presetLibrarySchema.safeParse({
        ...state,
        customBehaviors: [
          { ...custom, incoming: { ...custom.incoming, speed: NaN } },
        ],
      }).success,
    ).toBe(false);
  });

  it("工程自带自定义效果的名称和参数，不依赖本机预设库即可继续渲染", () => {
    const original = createBehavior("pop", 5)!;
    original.incoming.speed = 93;
    const custom = captureBehaviorPreset(original, "工程中的自定义弹出");
    const applied = { ...behaviorFromPreset(custom, 5), name: custom.name };
    const project = createProject();
    project.clips = [{ ...newText("titles", 0), behaviors: [applied] }];
    const saved = validateProject(JSON.parse(JSON.stringify(project))).clips[0]
      .behaviors![0];
    expect(saved.name).toBe(custom.name);
    expect(saved.preset).toBe(custom.id);
    expect(glyphMotion({ behaviors: [saved] }, 0.15, 1, 7, "text")).toEqual(
      glyphMotion({ behaviors: [original] }, 0.15, 1, 7, "text"),
    );
  });
});
