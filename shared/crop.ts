import type { Clip, Transform } from "./model";
import { defaultCrop } from "./effects";
import { localDelta, projectDelta } from "./rotation";

export type Crop = NonNullable<Clip["crop"]>;
export type ContentTransform = NonNullable<Clip["contentTransform"]>;
export const defaultContentTransform: ContentTransform = {
  x: 0,
  y: 0,
  scale: 1,
};
type Size = { width: number; height: number };
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function setContentTransform(
  clip: Clip,
  patch: Partial<ContentTransform>,
): Clip {
  if (!["image", "video"].includes(clip.kind)) return clip;
  const before = clip.contentTransform ?? defaultContentTransform;
  const next = { ...before, ...patch };
  if (!Object.values(next).every(Number.isFinite)) return clip;
  const contentTransform = {
    x: clamp(next.x, -4, 4),
    y: clamp(next.y, -4, 4),
    scale: clamp(next.scale, 1, 8),
  };
  if (
    Object.keys(contentTransform).every(
      (key) =>
        contentTransform[key as keyof ContentTransform] ===
        before[key as keyof ContentTransform],
    )
  )
    return clip;
  return { ...clip, contentTransform };
}

// Content offsets use full fitted source dimensions, before the outer clip
// transform and flips. The fixed crop window continues to use clip.transform.
export function panContent(
  clip: Clip,
  value: Transform,
  original: ContentTransform,
  delta: { x: number; y: number },
  size: Size,
): ContentTransform {
  const local = localDelta(value, delta, clip.rotation);
  return {
    ...original,
    x: clamp(
      original.x +
        (local.x / Math.max(1, size.width * value.scale)) *
          (clip.effects?.flipX ? -1 : 1),
      -4,
      4,
    ),
    y: clamp(
      original.y +
        (local.y / Math.max(1, size.height * value.scale)) *
          (clip.effects?.flipY ? -1 : 1),
      -4,
      4,
    ),
  };
}

export function contentOrigin(
  clip: Clip,
  view = clip.contentTransform ?? defaultContentTransform,
) {
  const crop = clip.crop ?? defaultCrop;
  return {
    x: (0.5 + (crop.left - crop.right) / 2) * (1 - view.scale) + view.x,
    y: (0.5 + (crop.top - crop.bottom) / 2) * (1 - view.scale) + view.y,
  };
}

export function contentLayout(
  clip: Clip,
  size: Size,
  view = clip.contentTransform ?? defaultContentTransform,
) {
  const origin = contentOrigin(clip, view);
  const crop = clip.crop ?? defaultCrop;
  return {
    width: size.width * view.scale,
    height: size.height * view.scale,
    left: size.width * (origin.x - crop.left),
    top: size.height * (origin.y - crop.top),
  };
}

export function croppedContent(clip: Clip, crop: Crop): ContentTransform {
  const before = clip.crop ?? defaultCrop;
  const content = clip.contentTransform ?? defaultContentTransform;
  return {
    ...content,
    x: clamp(
      content.x +
        ((crop.left - crop.right - before.left + before.right) / 2) *
          (content.scale - 1),
      -4,
      4,
    ),
    y: clamp(
      content.y +
        ((crop.top - crop.bottom - before.top + before.bottom) / 2) *
          (content.scale - 1),
      -4,
      4,
    ),
  };
}

// Sizes and deltas are in canvas pixels, before preview/camera zoom. Cropping
// changes the visible rectangle, never the scale of the retained source pixels.
export function dragCrop(
  original: Crop,
  value: Transform,
  delta: { x: number; y: number },
  handle: { x: number; y: number },
  size: Size,
  rotation = 0,
  flipX = false,
  flipY = false,
): Crop {
  const local = localDelta(value, delta, rotation);
  const dx =
    (local.x / Math.max(1, size.width * value.scale)) * (flipX ? -1 : 1);
  const dy =
    (local.y / Math.max(1, size.height * value.scale)) * (flipY ? -1 : 1);
  const hx = handle.x * (flipX ? -1 : 1);
  const hy = handle.y * (flipY ? -1 : 1);
  const next = { ...original };
  // Keep at least 2% of the source, and never exceed the project's crop limits.
  if (hx < 0)
    next.left = clamp(
      original.left + dx,
      0,
      Math.min(0.95, 0.98 - original.right),
    );
  if (hx > 0)
    next.right = clamp(
      original.right - dx,
      0,
      Math.min(0.95, 0.98 - original.left),
    );
  if (hy < 0)
    next.top = clamp(
      original.top + dy,
      0,
      Math.min(0.95, 0.98 - original.bottom),
    );
  if (hy > 0)
    next.bottom = clamp(
      original.bottom - dy,
      0,
      Math.min(0.95, 0.98 - original.top),
    );
  return next;
}

export function croppedTransform(
  clip: Clip,
  value: Transform,
  crop: Crop,
  size: Size,
  canvas: Size,
): Transform {
  const before = clip.crop ?? defaultCrop;
  const x =
    ((crop.left - crop.right - before.left + before.right) / 2) *
    size.width *
    value.scale *
    (clip.effects?.flipX ? -1 : 1);
  const y =
    ((crop.top - crop.bottom - before.top + before.bottom) / 2) *
    size.height *
    value.scale *
    (clip.effects?.flipY ? -1 : 1);
  const shift = projectDelta(value, { x, y }, clip.rotation);
  return {
    ...value,
    x: clamp(value.x + shift.x / canvas.width, -4, 4),
    y: clamp(value.y + shift.y / canvas.height, -4, 4),
  };
}

// Crop is a static clip property. Preserve existing animation endpoints without
// creating an animation when automatic animation mode is enabled.
export function cropClip(
  clip: Clip,
  crop: Crop,
  size: Size,
  canvas: Size,
): Clip {
  if (!["image", "video"].includes(clip.kind)) return clip;
  const before = clip.crop ?? defaultCrop;
  if (
    Object.keys(crop).every(
      (key) => crop[key as keyof Crop] === before[key as keyof Crop],
    )
  )
    return clip;
  return {
    ...clip,
    crop,
    ...(clip.contentTransform
      ? { contentTransform: croppedContent(clip, crop) }
      : {}),
    transform: croppedTransform(clip, clip.transform, crop, size, canvas),
    keyframes: clip.keyframes.map((frame) => ({
      ...frame,
      value: croppedTransform(clip, frame.value, crop, size, canvas),
    })),
  };
}
