import type { Clip, Transform } from "./model";
import { defaultVisualEffect, type Region } from "./visual-effects";

export const maskFields = {
  x: "maskX",
  y: "maskY",
  width: "maskWidth",
  height: "maskHeight",
  rotation: "maskRotation",
  opacity: "maskOpacity",
  feather: "maskFeather",
  radius: "maskRadius",
} as const;
export type MaskGeometry = Pick<Region, keyof typeof maskFields>;
export type MaskKey = (typeof maskFields)[keyof typeof maskFields];
export const maskKeys = Object.values(maskFields);
export const maskBounds: Record<MaskKey, [number, number]> = {
  maskX: [-1, 2],
  maskY: [-1, 2],
  maskWidth: [0.01, 3],
  maskHeight: [0.01, 3],
  maskRotation: [-3600, 3600],
  maskOpacity: [0, 1],
  maskFeather: [-100, 100],
  maskRadius: [0, 500],
};
const defaults = defaultVisualEffect("mask");
type MaskSource = Partial<Pick<Clip, "visualEffects">>;

export function maskDefaults(clip: MaskSource): Record<MaskKey, number> {
  const mask = clip.visualEffects?.mask ?? defaults;
  return Object.fromEntries(
    Object.entries(maskFields).map(([field, key]) => [
      key,
      mask[field as keyof MaskGeometry],
    ]),
  ) as Record<MaskKey, number>;
}
export function maskValues(
  clip: MaskSource & { transform: Transform },
  value: Transform,
) {
  const defaults = maskDefaults(clip);
  return Object.fromEntries(
    maskKeys.map((key) => {
      const next = value[key] ?? clip.transform[key] ?? defaults[key];
      return [
        key,
        Math.max(maskBounds[key][0], Math.min(maskBounds[key][1], next)),
      ];
    }),
  ) as Record<MaskKey, number>;
}
export function maskClipAt(clip: Clip, value: Transform): Clip {
  if (
    !clip.visualEffects?.mask ||
    !maskKeys.some(
      (key) => value[key] !== undefined || clip.transform[key] !== undefined,
    )
  )
    return clip;
  const values = maskValues(clip, value);
  return {
    ...clip,
    visualEffects: {
      ...clip.visualEffects,
      mask: {
        ...clip.visualEffects.mask,
        ...Object.fromEntries(
          Object.entries(maskFields).map(([field, key]) => [
            field,
            values[key],
          ]),
        ),
      },
    },
  };
}
export function hasMaskAnimation(
  clip: Pick<Clip, "transform" | "keyframes"> & MaskSource,
) {
  const defaults = maskDefaults(clip);
  return maskKeys.some((key) =>
    clip.keyframes.some(
      (frame) =>
        Math.abs(
          (frame.value[key] ?? clip.transform[key] ?? defaults[key]) -
            (clip.transform[key] ?? defaults[key]),
        ) > 1e-9,
    ),
  );
}
export function clearMaskChannels(clip: Clip): Clip {
  const strip = (value: Transform) =>
    Object.fromEntries(
      Object.entries(value).filter(
        ([key]) => !maskKeys.includes(key as MaskKey),
      ),
    ) as Transform;
  return {
    ...clip,
    transform: strip(clip.transform),
    keyframes: clip.keyframes.map((frame) => ({
      ...frame,
      value: strip(frame.value),
    })),
  };
}
