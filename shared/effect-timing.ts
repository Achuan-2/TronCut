import { z } from "zod";

const time = z.number().finite();
export const effectWindowSchema = z
  .object({
    start: time.min(0).max(86400),
    end: time.min(0).max(86400),
  })
  .refine((value) => value.end > value.start, "效果结束时间必须晚于开始时间");
export const effectOriginSchema = z.object({
  offset: time,
  duration: time.positive().max(86400),
});
export type EffectWindow = z.infer<typeof effectWindowSchema>;
export interface TimedEffect {
  enabled?: boolean;
  window?: EffectWindow;
  timing?: z.infer<typeof effectOriginSchema>;
}
export function originalEffectWindow(
  effect: TimedEffect,
  duration: number,
): EffectWindow {
  return (
    effect.window ?? { start: 0, end: effect.timing?.duration ?? duration }
  );
}
/** Visible local range, while stored times remain relative to the unsplit clip. */
export function effectWindow(
  effect: TimedEffect,
  duration: number,
): EffectWindow {
  const window = originalEffectWindow(effect, duration);
  const offset = effect.timing?.offset ?? 0;
  return {
    start: Math.max(0, Math.min(duration, window.start - offset)),
    end: Math.max(0, Math.min(duration, window.end - offset)),
  };
}
export function effectActive(
  effect: TimedEffect,
  local: number,
  duration: number,
) {
  if (effect.enabled === false) return false;
  if (!effect.window) return true;
  const { start, end } = effectWindow(effect, duration);
  return (
    end > start &&
    local >= start &&
    (local < end || (local === duration && end === duration))
  );
}
export function effectActiveExpression(
  effect: TimedEffect,
  clip: { start: number; duration: number },
  clock = "T",
) {
  if (effect.enabled === false) return "0";
  if (!effect.window) return "1";
  const offset = effect.timing?.offset ?? 0;
  return `gte(${clock},${clip.start + effect.window.start - offset})*lt(${clock},${clip.start + effect.window.end - offset})`;
}
