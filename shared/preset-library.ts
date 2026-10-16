import { z } from "zod";
import {
  behaviorPhaseSchema,
  behaviorPresets,
  type Behavior,
  type BehaviorPreset,
} from "./behaviors";

export const animationPresets = [
  { id: "fade", name: "轻柔淡入" },
  { id: "zoom", name: "平滑缩放" },
  { id: "slide", name: "侧边滑入" },
] as const;
export const visualEffectPresets = [
  { id: "rounded-corners", name: "圆角倒角" },
  { id: "clip-speed", name: "剪辑速度" },
] as const;
export type PresetKind = "behavior" | "animation" | "effect";
const nameSchema = z.string().trim().min(1).max(100);
const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const customBehaviorSchema = z.object({
  id: z.string().regex(/^user-[a-zA-Z0-9_-]{1,90}$/),
  name: nameSchema,
  incoming: behaviorPhaseSchema,
  during: behaviorPhaseSchema,
  outgoing: behaviorPhaseSchema,
});
export const presetLibrarySchema = z
  .object({
    version: z.literal(1),
    customBehaviors: z.array(customBehaviorSchema).max(1000).default([]),
    hiddenBehaviors: z.array(idSchema).max(1000).default([]),
    behaviorNames: z.record(idSchema, nameSchema).default({}),
    favorites: z
      .array(
        z.string().regex(/^(behavior|animation|effect):[a-zA-Z0-9_-]{1,100}$/),
      )
      .max(5000)
      .default([]),
  })
  .refine(
    (state) =>
      new Set(state.customBehaviors.map((preset) => preset.id)).size ===
      state.customBehaviors.length,
    "预设 ID 不能重复",
  );
export type PresetLibraryState = z.infer<typeof presetLibrarySchema>;
export const emptyPresetLibrary = (): PresetLibraryState =>
  presetLibrarySchema.parse({ version: 1 });
export const favoriteKey = (kind: PresetKind, id: string) => `${kind}:${id}`;
export function libraryBehaviors(
  state: PresetLibraryState,
  includeHidden = false,
): BehaviorPreset[] {
  return [
    ...behaviorPresets
      .filter(
        (preset) => includeHidden || !state.hiddenBehaviors.includes(preset.id),
      )
      .map((preset) => ({
        ...preset,
        name: state.behaviorNames[preset.id] ?? preset.name,
      })),
    ...state.customBehaviors,
  ];
}
export function captureBehaviorPreset(
  behavior: Behavior,
  name: string,
): BehaviorPreset {
  return customBehaviorSchema.parse({
    id: `user-${crypto.randomUUID()}`,
    name,
    incoming: structuredClone(behavior.incoming),
    during: structuredClone(behavior.during),
    outgoing: structuredClone(behavior.outgoing),
  });
}
export function deleteBehaviorPreset(
  state: PresetLibraryState,
  id: string,
): PresetLibraryState {
  return {
    ...state,
    customBehaviors: state.customBehaviors.filter((preset) => preset.id !== id),
    hiddenBehaviors: behaviorPresets.some((preset) => preset.id === id)
      ? [...new Set([...state.hiddenBehaviors, id])]
      : state.hiddenBehaviors,
    favorites: state.favorites.filter(
      (key) => key !== favoriteKey("behavior", id),
    ),
  };
}
export function renameBehaviorPreset(
  state: PresetLibraryState,
  id: string,
  name: string,
): PresetLibraryState {
  const trimmed = nameSchema.parse(name);
  return {
    ...state,
    customBehaviors: state.customBehaviors.map((preset) =>
      preset.id === id ? { ...preset, name: trimmed } : preset,
    ),
    behaviorNames: behaviorPresets.some((preset) => preset.id === id)
      ? { ...state.behaviorNames, [id]: trimmed }
      : state.behaviorNames,
  };
}
export function restoreDefaultBehaviors(
  state: PresetLibraryState,
): PresetLibraryState {
  return { ...state, hiddenBehaviors: [] };
}
