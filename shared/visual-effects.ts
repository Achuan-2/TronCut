import { z } from "zod";
import type { Clip } from "./model";
import {
  effectWindowSchema,
  effectOriginSchema,
  originalEffectWindow,
  effectActive,
} from "./effect-timing";

const number = z.number().finite();
const color = z.string().regex(/^#[\da-f]{6}$/i);
const common = z.object({
  enabled: z.boolean().default(true),
  easeIn: number.min(0).max(86400).default(0),
  easeOut: number.min(0).max(86400).default(0),
  intensity: number.min(0).max(1).default(1),
  timing: effectOriginSchema.optional(),
  window: effectWindowSchema.optional(),
});
const region = {
  shape: z.enum(["rectangle", "ellipse"]).default("ellipse"),
  x: number.min(-1).max(2).default(0.5),
  y: number.min(-1).max(2).default(0.5),
  width: number.min(0.01).max(3).default(0.8),
  height: number.min(0.01).max(3).default(0.8),
  rotation: number.min(-3600).max(3600).default(0),
  invert: z.boolean().default(false),
  feather: number.min(-100).max(100).default(-2),
  radius: number.min(0).max(500).default(0),
};
export const visualEffectSchemas = {
  "media-matte": common.extend({
    mode: z
      .enum(["alpha", "alpha-invert", "luma", "luma-invert"])
      .default("alpha"),
    strength: number.min(0).max(1).default(1),
  }),
  mask: common.extend({
    ...region,
    width: number.min(0.01).max(3).default(1),
    height: number.min(0.01).max(3).default(1),
    opacity: number.min(0).max(1).default(0),
  }),
  shadow: common.extend({
    angle: number.min(-3600).max(3600).default(315),
    color: color.default("#000000"),
    offset: number.min(0).max(500).default(10),
    opacity: number.min(0).max(1).default(0.4),
    blur: number.min(0).max(200).default(10),
  }),
  "remove-color": common.extend({
    color: color.default("#00ff00"),
    tolerance: number.min(0).max(1).default(0.1),
    softness: number.min(0).max(1).default(0.1),
    spill: number.min(0).max(1).default(0),
    defringe: number.min(-1).max(1).default(0),
    invert: z.boolean().default(false),
  }),
  tint: common.extend({
    color: color.default("#00ff00"),
    strength: number.min(0).max(1).default(1),
    range: z.enum(["all", "shadows", "midtones", "highlights"]).default("all"),
  }),
  "blur-region": common.extend({
    ...region,
    shape: z.enum(["rectangle", "ellipse"]).default("rectangle"),
    width: number.min(0.01).max(3).default(0.5),
    height: number.min(0.01).max(3).default(0.5),
    blur: number.min(0).max(200).default(40),
    color: color.default("#ffffff"),
    opacity: number.min(0).max(1).default(0.25),
  }),
  border: common.extend({
    color: color.default("#ffffff"),
    width: number.min(0).max(100).default(4),
    useAlpha: z.boolean().default(false),
  }),
};
export const visualEffectsSchema = z.object({
  "media-matte": visualEffectSchemas["media-matte"].optional(),
  mask: visualEffectSchemas.mask.optional(),
  shadow: visualEffectSchemas.shadow.optional(),
  "remove-color": visualEffectSchemas["remove-color"].optional(),
  tint: visualEffectSchemas.tint.optional(),
  "blur-region": visualEffectSchemas["blur-region"].optional(),
  border: visualEffectSchemas.border.optional(),
});
export type VisualEffects = z.infer<typeof visualEffectsSchema>;
export type AdditionalVisualEffectId = keyof VisualEffects;
export type Region = z.infer<typeof visualEffectSchemas.mask>;
export type EffectTiming = z.infer<typeof common>;
export const additionalVisualEffectPresets = [
  { id: "media-matte", name: "媒体遮罩" },
  { id: "mask", name: "遮罩" },
  { id: "shadow", name: "阴影" },
  { id: "remove-color", name: "移除颜色" },
  { id: "tint", name: "着色" },
  { id: "blur-region", name: "模糊区域" },
  { id: "border", name: "边框" },
] as const;

export function isAdditionalVisualEffect(
  id: string,
): id is AdditionalVisualEffectId {
  return Object.hasOwn(visualEffectSchemas, id);
}
export function defaultVisualEffect<K extends AdditionalVisualEffectId>(
  id: K,
): NonNullable<VisualEffects[K]> {
  return visualEffectSchemas[id].parse({}) as NonNullable<VisualEffects[K]>;
}
export function addVisualEffect(
  clip: Clip,
  id: AdditionalVisualEffectId,
): Clip {
  if (clip.kind === "audio" || clip.visualEffects?.[id]) return clip;
  return {
    ...clip,
    visualEffects: { ...clip.visualEffects, [id]: defaultVisualEffect(id) },
  };
}
export function effectAmount(
  effect: EffectTiming,
  time: number,
  duration: number,
) {
  if (!effectActive(effect, time, duration)) return 0;
  const window = originalEffectWindow(effect, duration);
  time += effect.timing?.offset ?? 0;
  time -= window.start;
  duration = window.end - window.start;
  const ratio = Math.min(
    1,
    duration / Math.max(duration, effect.easeIn + effect.easeOut),
  );
  const incoming = effect.easeIn * ratio;
  const outgoing = effect.easeOut * ratio;
  return (
    effect.intensity *
    Math.max(
      0,
      Math.min(
        1,
        incoming ? time / incoming : 1,
        outgoing ? (duration - time) / outgoing : 1,
      ),
    )
  );
}
export function freezeVisualEffects(
  clip: Clip,
  time: number,
): VisualEffects | undefined {
  if (!clip.visualEffects) return undefined;
  return Object.fromEntries(
    Object.entries(clip.visualEffects)
      .filter(([, effect]) => !!effect)
      .map(([id, effect]) => [
        id,
        {
          ...effect,
          enabled: effectActive(effect, time, clip.duration),
          intensity: effectAmount(effect, time, clip.duration),
          easeIn: 0,
          easeOut: 0,
          timing: undefined,
          window: undefined,
        },
      ]),
  );
}
export function shiftVisualEffects(
  clip: Clip,
  offset: number,
): VisualEffects | undefined {
  if (!clip.visualEffects) return undefined;
  return Object.fromEntries(
    Object.entries(clip.visualEffects)
      .filter(([, effect]) => !!effect)
      .map(([id, effect]) => [
        id,
        {
          ...effect,
          timing: {
            offset: (effect.timing?.offset ?? 0) + offset,
            duration: effect.timing?.duration ?? clip.duration,
          },
        },
      ]),
  );
}
export function retimeVisualEffects(
  clip: Clip,
  ratio: number,
): VisualEffects | undefined {
  if (!clip.visualEffects) return undefined;
  return Object.fromEntries(
    Object.entries(clip.visualEffects)
      .filter(([, effect]) => !!effect)
      .map(([id, effect]) => [
        id,
        {
          ...effect,
          easeIn: effect.easeIn * ratio,
          easeOut: effect.easeOut * ratio,
          window: effect.window
            ? {
              start: effect.window.start * ratio,
              end: effect.window.end * ratio,
            }
            : undefined,
          timing: effect.timing
            ? {
              offset: effect.timing.offset * ratio,
              duration: effect.timing.duration * ratio,
            }
            : undefined,
        },
      ]),
  );
}
export function rgb(color: string) {
  return [1, 3, 5].map(
    (start) => Number.parseInt(color.slice(start, start + 2), 16) / 255,
  );
}
export function tintRange(
  range: NonNullable<VisualEffects["tint"]>["range"],
  luminance: number,
) {
  if (range === "shadows") return Math.max(0, 1 - luminance * 2);
  if (range === "highlights") return Math.max(0, luminance * 2 - 1);
  if (range === "midtones") return Math.max(0, 1 - Math.abs(luminance * 2 - 1));
  return 1;
}
export function keyAlpha(
  effect: NonNullable<VisualEffects["remove-color"]>,
  distance: number,
) {
  const threshold = Math.max(
    0,
    Math.min(1, effect.tolerance + effect.defringe * 0.1),
  );
  const value = Math.max(
    0,
    Math.min(1, (distance - threshold) / Math.max(0.0001, effect.softness)),
  );
  return effect.invert ? 1 - value : value;
}
