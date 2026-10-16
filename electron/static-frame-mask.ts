import fs from "node:fs/promises";
import type { Clip } from "../shared/model";
import { defaultFrameCorners, frameCorners } from "../shared/media-frame";
import { hasVisualAnimation } from "../shared/visual-state";

/** Match mediaFrameFilters at pixel centers, without evaluating GEQ every frame. */
export function staticFrameMask(
  clip: Clip,
  width: number,
  height: number,
  fit: number,
): Buffer | undefined {
  const frame = clip.mediaFrame;
  if (!frame || frame.enabled === false || !frame.radius || frame.window)
    return;
  // A changing crop changes the mask boundary. Keep that on the general renderer.
  // Content-only camera motion leaves the outer frame fixed and can reuse a mask.
  if (
    hasVisualAnimation(clip) &&
    (Object.values(clip.crop ?? {}).some(Boolean) ||
      [
        clip.transform,
        ...clip.keyframes.map((keyframe) => keyframe.value),
      ].some((value) =>
        [value.cropLeft, value.cropTop, value.cropRight, value.cropBottom].some(
          Boolean,
        ),
      ))
  )
    return;
  const corners = frame.corners ?? defaultFrameCorners;
  if (!frameCorners.some((corner) => corners[corner])) return;
  const radius = Math.min(
    frame.unit === "percent"
      ? (Math.min(width, height) * frame.radius) / 200
      : frame.radius / fit,
    width / 2,
    height / 2,
  );
  const pixels = Buffer.alloc(width * height, 255);
  // Only corner squares can contain transparent pixels; the rest stays opaque.
  const edge = Math.ceil(radius);
  for (const [index, corner] of frameCorners.entries()) {
    if (!corners[corner]) continue;
    for (let y = 0; y < edge; y++) {
      const dy = Math.max(radius - y - 0.5, 0);
      const row = index < 2 ? y : height - 1 - y;
      for (let x = 0; x < edge; x++) {
        const dx = Math.max(radius - x - 0.5, 0);
        const column = index === 0 || index === 3 ? x : width - 1 - x;
        if (dx * dx + dy * dy > radius * radius)
          pixels[row * width + column] = 0;
      }
    }
  }
  return Buffer.concat([Buffer.from(`P5\n${width} ${height}\n255\n`), pixels]);
}

/** Read the mask once; FFmpeg framesync repeats it for the lifetime of the clip. */
export async function staticFrameMaskFilters(options: {
  clip: Clip;
  width: number;
  height: number;
  fit: number;
  file: string;
  source: string;
  layer: number;
  input: number;
}) {
  const { clip, width, height, fit, file, source, layer, input } = options;
  const mask = staticFrameMask(clip, width, height, fit);
  if (!mask) return;
  await fs.writeFile(file, mask);
  const color = `frameColor${layer}`,
    alpha = `frameAlpha${layer}`;
  const original = `frameOriginalAlpha${layer}`,
    masked = `frameMaskedAlpha${layer}`;
  const label = `frameRounded${layer}`;
  return {
    args: ["-threads", "1", "-i", file],
    filters: [
      `[${source}]format=rgba,split[${color}][${alpha}]`,
      `[${alpha}]alphaextract[${original}]`,
      `[${original}][${input}:v]blend=all_mode=multiply:repeatlast=1[${masked}]`,
      `[${color}][${masked}]alphamerge[${label}]`,
    ],
    label,
  };
}
