import type { Clip, Transform } from "./model";
import { maskClipAt } from "./mask-state";

export const visualKeys = [
  "contentX",
  "contentY",
  "contentScale",
  "cropLeft",
  "cropTop",
  "cropRight",
  "cropBottom",
] as const;
export type VisualKey = (typeof visualKeys)[number];
export type VisualValues = Record<VisualKey, number>;
type VisualSource = Partial<Pick<Clip, "crop" | "contentTransform">>;
export function visualDefaults(clip: VisualSource): VisualValues {
  return {
    contentX: clip.contentTransform?.x ?? 0,
    contentY: clip.contentTransform?.y ?? 0,
    contentScale: clip.contentTransform?.scale ?? 1,
    cropLeft: clip.crop?.left ?? 0,
    cropTop: clip.crop?.top ?? 0,
    cropRight: clip.crop?.right ?? 0,
    cropBottom: clip.crop?.bottom ?? 0,
  };
}
export function visualValues(
  clip: VisualSource & { transform: Transform },
  value: Transform,
): VisualValues {
  const defaults = visualDefaults(clip);
  const result = Object.fromEntries(
    visualKeys.map((key) => [
      key,
      value[key] ?? clip.transform[key] ?? defaults[key],
    ]),
  ) as VisualValues;
  // Spring/bounce curves can overshoot: keep the sampled viewport valid.
  result.contentScale = Math.max(0.05, Math.min(8, result.contentScale));
  for (const key of ["cropLeft", "cropTop", "cropRight", "cropBottom"] as const)
    result[key] = Math.max(0, Math.min(0.95, result[key]));
  for (const [a, b] of [
    ["cropLeft", "cropRight"],
    ["cropTop", "cropBottom"],
  ] as const) {
    const sum = result[a] + result[b];
    if (sum > 0.98) {
      result[a] *= 0.98 / sum;
      result[b] *= 0.98 / sum;
    }
  }
  return result;
}
export function visualClipAt(clip: Clip, value: Transform): Clip {
  clip = maskClipAt(clip, value);
  const state = visualValues(clip, value);
  return {
    ...clip,
    crop: {
      left: state.cropLeft,
      top: state.cropTop,
      right: state.cropRight,
      bottom: state.cropBottom,
    },
    contentTransform: {
      x: state.contentX,
      y: state.contentY,
      scale: state.contentScale,
    },
  };
}
export function hasVisualAnimation(
  clip: Pick<Clip, "transform" | "keyframes">,
) {
  return visualKeys.some(
    (key) =>
      clip.transform[key] !== undefined ||
      clip.keyframes.some((frame) => frame.value[key] !== undefined),
  );
}
