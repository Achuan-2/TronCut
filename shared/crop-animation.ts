import type { Clip, Transform } from "./model";
import { setTransform, setKeyframeTransform, transformAt } from "./editor";
import {
  cropClip,
  croppedContent,
  croppedTransform,
  setContentTransform,
  type Crop,
  type ContentTransform,
} from "./crop";
import {
  hasVisualAnimation,
  visualClipAt,
  visualValues,
  type VisualValues,
} from "./visual-state";

export interface VisualEdit {
  time: number;
  auto: boolean;
  endpoint?: { time: number; side: "start" | "end" };
  duration?: number;
}
function setVisual(
  clip: Clip,
  patch: Partial<Transform>,
  edit: VisualEdit,
): Clip {
  // Freeze the previous static state into every point before the first visual
  // edit, so changing a selected start cannot alter an implicit end value.
  const normalize = (value: Transform) => ({
    ...value,
    ...visualValues(clip, value),
  });
  const source = {
    ...clip,
    transform: normalize(clip.transform),
    keyframes: clip.keyframes.map((frame) => ({
      ...frame,
      value: normalize(frame.value),
    })),
  };
  const next = edit.endpoint
    ? setKeyframeTransform(
        source,
        patch,
        edit.endpoint.time,
        edit.endpoint.side === "start",
      )
    : setTransform(source, patch, edit.time, edit.auto, edit.duration);
  return next;
}
export function animateContent(
  clip: Clip,
  patch: Partial<ContentTransform>,
  edit: VisualEdit,
): Clip {
  if (!["image", "video"].includes(clip.kind)) return clip;
  if (!edit.auto && !edit.endpoint && !hasVisualAnimation(clip))
    return setContentTransform(clip, patch);
  const value = transformAt(clip, edit.time),
    sampled = visualClipAt(clip, value);
  const changed = setContentTransform(sampled, patch);
  if (changed === sampled) return clip;
  const content = changed.contentTransform!;
  const fields: Partial<VisualValues> = {};
  for (const [key, field] of [
    ["x", "contentX"],
    ["y", "contentY"],
    ["scale", "contentScale"],
  ] as const)
    if (patch[key] !== undefined) fields[field] = content[key];
  return setVisual(clip, fields, edit);
}
export function animateCrop(
  clip: Clip,
  crop: Crop,
  size: { width: number; height: number },
  canvas: { width: number; height: number },
  edit: VisualEdit,
  resetContent = false,
): Clip {
  if (!["image", "video"].includes(clip.kind)) return clip;
  if (!edit.auto && !edit.endpoint && !hasVisualAnimation(clip)) {
    const changed = cropClip(clip, crop, size, canvas);
    return resetContent ? { ...changed, contentTransform: undefined } : changed;
  }
  if (!edit.auto && !edit.endpoint) {
    const change = (value: Transform) => {
      const sampled = visualClipAt(clip, value);
      const position = croppedTransform(sampled, value, crop, size, canvas);
      const content = resetContent
        ? { x: 0, y: 0, scale: 1 }
        : croppedContent(sampled, crop);
      return {
        ...position,
        cropLeft: crop.left,
        cropTop: crop.top,
        cropRight: crop.right,
        cropBottom: crop.bottom,
        contentX: content.x,
        contentY: content.y,
        contentScale: content.scale,
      };
    };
    return {
      ...clip,
      transform: change(clip.transform),
      keyframes: clip.keyframes.map((frame) => ({
        ...frame,
        value: change(frame.value),
      })),
    };
  }
  const value = transformAt(clip, edit.time),
    sampled = visualClipAt(clip, value);
  const position = croppedTransform(sampled, value, crop, size, canvas);
  const content = resetContent
    ? { x: 0, y: 0, scale: 1 }
    : croppedContent(sampled, crop);
  const fields = {
    cropLeft: crop.left,
    cropTop: crop.top,
    cropRight: crop.right,
    cropBottom: crop.bottom,
    contentX: content.x,
    contentY: content.y,
    contentScale: content.scale,
    x: position.x,
    y: position.y,
  };
  if (
    Object.entries(fields).every(
      ([key, next]) =>
        Math.abs(
          (key === "x" || key === "y"
            ? value[key]
            : visualValues(clip, value)[key as keyof VisualValues]) - next,
        ) < 1e-9,
    )
  )
    return clip;
  return setVisual(clip, fields, edit);
}
