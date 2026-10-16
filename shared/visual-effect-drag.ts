import type { Clip } from "./model";
import { supportsClipSpeed } from "./clip-speed";
import { supportsMediaFrame } from "./media-frame";
import { visualEffectPresets } from "./preset-library";
import { isAdditionalVisualEffect } from "./visual-effects";

export const visualEffectMime = "troncut-effect";
export type VisualEffectId = (typeof visualEffectPresets)[number]["id"];

export function visualEffectDragType(effect: VisualEffectId) {
  return `${visualEffectMime}/${effect}`;
}

// Drag data is protected until drop; encode the preset in a MIME type so hover
// feedback can reject incompatible objects before the user releases the mouse.
export function visualEffectFromDragTypes(types: readonly string[]) {
  return visualEffectPresets.find((preset) =>
    types.includes(visualEffectDragType(preset.id)),
  )?.id;
}

export function supportsVisualEffect(clip: Clip, effect: string | undefined) {
  if (effect === "clip-speed") return supportsClipSpeed(clip);
  if (effect === "rounded-corners") return supportsMediaFrame(clip);
  if (effect && isAdditionalVisualEffect(effect)) return clip.kind !== "audio";
  return false;
}
