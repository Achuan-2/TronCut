import type { Clip, Transform } from "./model";
import type { AnimationEasing } from "./easing";
import {
  animationRanges,
  sameTransform,
  type AnimationRange,
} from "./animation-ranges";
import { transformAt } from "./editor";

export interface CopiedAnimation {
  duration: number;
  from: Transform;
  to: Transform;
  easing?: AnimationEasing;
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
    sameTransform(
      pair.b.value,
      pair.frames[i].value,
      clip.transform.rotation ?? clip.rotation ?? 0,
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
  const from = transformAt(clip, localStart);
  const to = { ...from };
  // Paste the same motion relative to the target's current state. This keeps
  // its preceding hold intact, instead of adding a transition to copied values.
  const bounds: Record<keyof Transform, [number, number]> = {
    x: [-4, 4],
    y: [-4, 4],
    scale: [0.05, 8],
    opacity: [0, 1],
    rotation: [-3600, 3600],
  };
  for (const key of Object.keys(bounds) as (keyof Transform)[]) {
    if (
      key === "rotation" &&
      copied.from.rotation === undefined &&
      copied.to.rotation === undefined
    )
      continue;
    const value =
      (from[key] ?? 0) + (copied.to[key] ?? 0) - (copied.from[key] ?? 0);
    to[key] = Math.max(bounds[key][0], Math.min(bounds[key][1], value));
  }
  let holding = true;
  const rotation = clip.transform.rotation ?? clip.rotation ?? 0;
  const frames = [...clip.keyframes]
    .sort((a, b) => a.time - b.time)
    .filter((frame) => frame.time < start || frame.time > end)
    .map((frame) => {
      if (frame.time <= end || !holding) return frame;
      if (!sameTransform(frame.value, from, rotation)) {
        holding = false;
        return frame;
      }
      return { ...frame, value: { ...to } };
    });
  frames.push(
    { time: start, value: from },
    { time: end, value: to, easing: copied.easing },
  );
  return { ...clip, keyframes: frames.sort((a, b) => a.time - b.time) };
}
