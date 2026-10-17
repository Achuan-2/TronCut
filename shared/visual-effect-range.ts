import type { Clip } from "./model";
import {
  additionalVisualEffectPresets,
  type AdditionalVisualEffectId,
} from "./visual-effects";
import { effectWindow, type EffectWindow } from "./effect-timing";

export type RangedVisualEffectId = AdditionalVisualEffectId | "rounded-corners";
const entriesCache = new WeakMap<
  Clip,
  ReturnType<typeof buildVisualEffectEntries>
>();
function buildVisualEffectEntries(clip: Clip) {
  return [
    ...(clip.mediaFrame
      ? [
          {
            id: "rounded-corners" as const,
            name: "圆角倒角",
            effect: clip.mediaFrame,
          },
        ]
      : []),
    ...additionalVisualEffectPresets.flatMap(({ id, name }) =>
      clip.visualEffects?.[id]
        ? [{ id, name, effect: clip.visualEffects[id]! }]
        : [],
    ),
  ];
}
export function visualEffectEntries(clip: Clip) {
  const cached = entriesCache.get(clip);
  if (cached) return cached;
  const entries = buildVisualEffectEntries(clip);
  entriesCache.set(clip, entries);
  return entries;
}
export function rangedVisualEffect(clip: Clip, id: RangedVisualEffectId) {
  return id === "rounded-corners" ? clip.mediaFrame : clip.visualEffects?.[id];
}
export function setVisualEffectWindow(
  clip: Clip,
  id: RangedVisualEffectId,
  window: EffectWindow,
): Clip {
  const effect = rangedVisualEffect(clip, id);
  if (!effect || !Number.isFinite(window.start) || !Number.isFinite(window.end))
    return clip;
  const start = Math.max(0, Math.min(clip.duration, window.start));
  const end = Math.max(0, Math.min(clip.duration, window.end));
  if (end <= start) return clip;
  const previous = effectWindow(effect, clip.duration);
  if (
    Math.abs(previous.start - start) < 1e-9 &&
    Math.abs(previous.end - end) < 1e-9
  )
    return clip;
  const offset = effect.timing?.offset ?? 0;
  const value = {
    ...effect,
    window: { start: start + offset, end: end + offset },
  };
  return id === "rounded-corners"
    ? { ...clip, mediaFrame: value as Clip["mediaFrame"] }
    : { ...clip, visualEffects: { ...clip.visualEffects, [id]: value } };
}
export function dragVisualEffectWindow(
  clip: Clip,
  id: RangedVisualEffectId,
  mode: "start" | "end" | "move",
  delta: number,
  fps: number,
) {
  const effect = rangedVisualEffect(clip, id);
  if (!effect || !Number.isFinite(delta) || !Number.isFinite(fps) || fps <= 0)
    return clip;
  const window = effectWindow(effect, clip.duration);
  const minimum = Math.min(1 / fps, clip.duration);
  // A split can leave this effect entirely outside the retained segment.
  // Keep its stored timing until the user explicitly extends an endpoint.
  if (window.end <= window.start) {
    if (mode === "move") return clip;
    if (mode === "start") window.end = Math.max(minimum, window.end);
    else window.start = Math.min(clip.duration - minimum, window.start);
  }
  const snap = (value: number) =>
    Math.round((clip.start + value) * fps) / fps - clip.start;
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value));
  if (mode === "start")
    return setVisualEffectWindow(clip, id, {
      start: clamp(snap(window.start + delta), 0, window.end - minimum),
      end: window.end,
    });
  if (mode === "end")
    return setVisualEffectWindow(clip, id, {
      start: window.start,
      end: clamp(
        snap(window.end + delta),
        window.start + minimum,
        clip.duration,
      ),
    });
  const shift = clamp(
    Math.round(delta * fps) / fps,
    -window.start,
    clip.duration - window.end,
  );
  return setVisualEffectWindow(clip, id, {
    start: window.start + shift,
    end: window.end + shift,
  });
}
