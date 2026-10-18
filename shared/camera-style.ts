import type { CameraStyle } from "./recording-settings";
import { defaultVisualEffect } from "./visual-effects";

/** Circle diameter is based on the shorter source edge, never an oval. */
export function cameraMask(style: CameraStyle, width: number, height: number) {
  const diameter = Math.min(width, height) * style.maskSize;
  return {
    ...defaultVisualEffect("mask"),
    shape:
      style.preset === "circle" ? ("ellipse" as const) : ("rectangle" as const),
    x: style.maskX,
    y: style.maskY,
    width: diameter / width,
    height: diameter / height,
    feather: 0,
    radius: style.preset === "rounded" ? diameter * 0.15 : 0,
  };
}

export function cameraClipPath(
  style: CameraStyle,
  width: number,
  height: number,
) {
  if (style.preset === "rectangle") return "none";
  const diameter = Math.min(width, height) * style.maskSize;
  // The media element is mirrored with a CSS transform. Mirror the local
  // clip coordinates as well so the mask keeps its configured screen position.
  const maskX = style.mirror ? 1 - style.maskX : style.maskX;
  const mask = {
    x: maskX,
    y: style.maskY,
    width: diameter / width,
    height: diameter / height,
  };
  if (style.preset === "circle")
    return `ellipse(${mask.width * 50}% ${mask.height * 50}% at ${mask.x * 100}% ${mask.y * 100}%)`;
  return `inset(${(mask.y - mask.height / 2) * 100}% ${(1 - mask.x - mask.width / 2) * 100}% ${(1 - mask.y - mask.height / 2) * 100}% ${(mask.x - mask.width / 2) * 100}% round ${mask.width * 15}% / ${mask.height * 15}%)`;
}
