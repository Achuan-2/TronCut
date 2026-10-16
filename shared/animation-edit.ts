import type { Clip, Transform } from "./model";
import type { AnimationEasing } from "./easing";
import {
  animationRanges,
  sameTransform,
  type AnimationRange,
} from "./animation-ranges";
import { transformAt } from "./editor";
import { visualKeys, visualValues } from "./visual-state";
import { maskKeys, maskValues, maskBounds } from "./mask-state";

export interface CopiedAnimation {
  duration: number;
  from: Transform;
  to: Transform;
  easing?: AnimationEasing;
}

// An explicit animation can begin with identical states. Its end marker keeps
// the arrow visible until the user edits it; ordinary equal frames remain holds.
export function addAnimationKeyframe(
  clip: Clip,
  localTime: number,
  fps: number,
  duration = 1,
): { clip: Clip; time: number } | null {
  if (
    !Number.isFinite(localTime) ||
    clip.kind === "audio" ||
    localTime < 0 ||
    localTime > clip.duration
  )
    return null;
  const localEnd =
    localTime < 1 / fps ? Math.min(duration, clip.duration) : localTime;
  const offset = clip.animationOffset ?? 0;
  const end = localEnd + offset;
  const frames = [...clip.keyframes].sort((a, b) => a.time - b.time);
  const existingRange = animationRanges(clip).find(
    (range) => Math.abs(range.end - localEnd) < 1e-6,
  );
  if (existingRange) return { clip, time: localEnd };
  const previous = frames.filter((frame) => frame.time < end).at(-1);
  const start = Math.max(0, offset, end - duration, previous?.time ?? 0);
  if (start >= end) return null;
  if (!frames.some((frame) => Math.abs(frame.time - start) < 1e-6))
    frames.push({ time: start, value: transformAt(clip, start - offset) });
  const value = transformAt(clip, localEnd);
  const endpoint = frames.find((frame) => Math.abs(frame.time - end) < 1e-6);
  const keyframes = endpoint
    ? frames.map((frame) =>
        frame === endpoint ? { ...frame, animation: true as const } : frame,
      )
    : [...frames, { time: end, value, animation: true as const }];
  return {
    clip: { ...clip, keyframes: keyframes.sort((a, b) => a.time - b.time) },
    time: localEnd,
  };
}

function rangeFrames(clip: Clip, range: AnimationRange) {
  const frames = [...clip.keyframes].sort((a, b) => a.time - b.time);
  if (frames[0]?.time > 0) frames.unshift({ time: 0, value: clip.transform });
  const offset = clip.animationOffset ?? 0;
  const index = frames.findIndex(
    (frame, i) =>
      i + 1 < frames.length &&
      Math.max(0, frame.time - offset) === range.start &&
      Math.min(clip.duration, frames[i + 1].time - offset) === range.end,
  );
  return index < 0
    ? null
    : { frames, index, a: frames[index], b: frames[index + 1] };
}

export function snapshotAnimation(
  clip: Clip,
  range: AnimationRange,
): CopiedAnimation | null {
  const pair = rangeFrames(clip, range);
  return pair
    ? {
        duration: range.end - range.start,
        from: transformAt(clip, range.start),
        to: transformAt(clip, range.end),
        easing: pair.b.easing,
      }
    : null;
}

export function setAnimationEasing(
  clip: Clip,
  range: AnimationRange,
  easing: AnimationEasing,
): Clip {
  const pair = rangeFrames(clip, range);
  if (!pair) return clip;
  return {
    ...clip,
    keyframes: clip.keyframes.map((frame) =>
      frame === pair.b ? { ...frame, easing } : frame,
    ),
  };
}

export function removeAnimation(clip: Clip, range: AnimationRange): Clip {
  const pair = rangeFrames(clip, range);
  if (!pair) return clip;
  const held = new Set([pair.b]);
  for (
    let i = pair.index + 2;
    i < pair.frames.length &&
    !pair.frames[i].animation &&
    sameTransform(
      pair.b.value,
      pair.frames[i].value,
      clip.transform.rotation ?? clip.rotation ?? 0,
      clip.transform,
    );
    i++
  )
    held.add(pair.frames[i]);
  // Hold the starting state instead of the removed motion. Updating following
  // hold frames prevents a replacement arrow from appearing in the gap.
  return {
    ...clip,
    keyframes: clip.keyframes.map((frame) =>
      held.has(frame)
        ? {
            ...frame,
            value: { ...pair.a.value },
            easing: undefined,
            animation: undefined,
            zoomPan: pair.a.zoomPan,
          }
        : frame,
    ),
  };
}

export function pasteAnimation(
  clip: Clip,
  copied: CopiedAnimation,
  localStart: number,
): Clip {
  const localEnd = localStart + copied.duration;
  if (
    localStart < 0 ||
    localEnd > clip.duration ||
    copied.duration <= 0 ||
    animationRanges(clip).some(
      (range) => range.start < localEnd && range.end > localStart,
    )
  )
    return clip;
  const offset = clip.animationOffset ?? 0;
  const start = localStart + offset,
    end = localEnd + offset;
  if (start < 0) return clip;
  const sampled = transformAt(clip, localStart);
  let from = visualKeys.some(
    (key) => copied.from[key] !== undefined || copied.to[key] !== undefined,
  )
    ? { ...sampled, ...visualValues(clip, sampled) }
    : sampled;
  if (maskKeys.some((key) => copied.from[key] !== undefined || copied.to[key] !== undefined)) from = { ...from, ...maskValues(clip, sampled) };
  const to = { ...from };
  // Paste the same motion relative to the target's current state. This keeps
  // its preceding hold intact, instead of adding a transition to copied values.
  const bounds: Record<keyof Transform, [number, number]> = {
    ...maskBounds,
    x: [-4, 4],
    y: [-4, 4],
    scale: [0.05, 8],
    scaleX: [0.05, 8],
    scaleY: [0.05, 8],
    opacity: [0, 1],
    rotation: [-3600, 3600],
    rotationX: [-3600, 3600],
    rotationY: [-3600, 3600],
    skew: [-80, 80],
    z: [-10000, 1000],
    contentX: [-4, 4],
    contentY: [-4, 4],
    contentScale: [0.05, 8],
    cropLeft: [0, 0.95],
    cropTop: [0, 0.95],
    cropRight: [0, 0.95],
    cropBottom: [0, 0.95],
  };
  for (const key of Object.keys(bounds) as (keyof Transform)[]) {
    if (
      !["x", "y", "scale", "opacity"].includes(key) &&
      copied.from[key] === undefined &&
      copied.to[key] === undefined
    )
      continue;
    const fallback = key === "scaleX" || key === "scaleY" ? 1 : 0;
    const value =
      (from[key] ?? fallback) +
      (copied.to[key] ?? fallback) -
      (copied.from[key] ?? fallback);
    to[key] = Math.max(bounds[key][0], Math.min(bounds[key][1], value));
  }
  if (visualKeys.some((key) => to[key] !== undefined))
    Object.assign(to, visualValues(clip, to));
  if (maskKeys.some((key) => to[key] !== undefined)) Object.assign(to, maskValues(clip, to));
  let holding = true;
  const rotation = clip.transform.rotation ?? clip.rotation ?? 0;
  const frames = [...clip.keyframes]
    .sort((a, b) => a.time - b.time)
    .filter((frame) => frame.time < start || frame.time > end)
    .map((frame) => {
      if (frame.time <= end || !holding) return frame;
      if (!sameTransform(frame.value, from, rotation, clip.transform)) {
        holding = false;
        return frame;
      }
      return { ...frame, value: { ...to } };
    });
  frames.push(
    { time: start, value: from },
    { time: end, value: to, easing: copied.easing, animation: true },
  );
  return { ...clip, keyframes: frames.sort((a, b) => a.time - b.time) };
}
