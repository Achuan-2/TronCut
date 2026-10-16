import type { Clip, Transform } from "./model";
import {
  normalizeRotationAxes,
  optionalTransformKeys,
  axisScaleKeys,
} from "./rotation";
import { visualKeys, visualDefaults } from "./visual-state";
import { maskKeys, maskDefaults, maskValues } from "./mask-state";
const defaultVisual = visualDefaults({});
const defaultMask = maskDefaults({});

export function sameTransform(
  a: Transform,
  b: Transform,
  rotation = 0,
  fallback: Partial<Transform> = {},
) {
  return (
    (["x", "y", "scale", "opacity"] as const).every(
      (key) => Math.abs(a[key] - b[key]) < 1e-9,
    ) &&
    Math.abs((a.rotation ?? rotation) - (b.rotation ?? rotation)) < 1e-9 &&
    axisScaleKeys.every(
      (key) =>
        Math.abs(
          (a[key] ?? fallback[key] ?? 1) - (b[key] ?? fallback[key] ?? 1),
        ) < 1e-9,
    ) &&
    (["rotationX", "rotationY", "skew", "z"] as const).every(
      (key) =>
        Math.abs(
          (a[key] ?? fallback[key] ?? 0) - (b[key] ?? fallback[key] ?? 0),
        ) < 1e-9,
    ) &&
    maskKeys.every(
      (key) =>
        Math.abs(
          (a[key] ?? fallback[key] ?? defaultMask[key]) -
            (b[key] ?? fallback[key] ?? defaultMask[key]),
        ) < 1e-9,
    ) &&
    visualKeys.every(
      (key) =>
        Math.abs(
          (a[key] ?? fallback[key] ?? defaultVisual[key]) -
            (b[key] ?? fallback[key] ?? defaultVisual[key]),
        ) < 1e-9,
    )
  );
}

// The start state belongs to the preceding animation's end, including across
// a hold. With no preceding animation, it belongs to the initial state.
export function animationEditTarget(
  clip: Clip,
  time: number,
  side: "start" | "end",
) {
  if (side === "end") return { time, side };
  const offset = clip.animationOffset ?? 0;
  const previous = animationRanges(clip)
    .filter((range) => range.hasEnd && range.end + offset <= time + 1e-6)
    .at(-1);
  return previous
    ? { time: previous.end + offset, side: "end" as const }
    : { time, side };
}

export interface AnimationRange {
  start: number;
  end: number;
  hasStart: boolean;
  hasEnd: boolean;
}

/** Ranges from animationRanges are ordered and do not overlap. Keep the global
 * index as the React key so scrolling or a captured drag cannot retarget it.
 */
export function visibleAnimationRanges(
  ranges: readonly AnimationRange[],
  start: number,
  end: number,
  pinnedIndex = -1,
): { range: AnimationRange; index: number }[] {
  let lo = 0,
    hi = ranges.length;
  while (lo < hi) {
    const mid = lo + ((hi - lo) >> 1);
    if (ranges[mid].end < start) lo = mid + 1;
    else hi = mid;
  }
  const result: { range: AnimationRange; index: number }[] = [];
  for (
    let index = lo;
    index < ranges.length && ranges[index].start <= end;
    index++
  )
    result.push({ range: ranges[index], index });
  if (
    ranges[pinnedIndex] &&
    !result.some((entry) => entry.index === pinnedIndex)
  ) {
    result.push({ range: ranges[pinnedIndex], index: pinnedIndex });
    result.sort((a, b) => a.index - b.index);
  }
  return result;
}

export type AnimationDragMode = "start" | "end" | "move";

/** Destination samples with one ID form a single editable recording animation. */
export function recordingSegments(frames: Clip["keyframes"]) {
  const groups: { id: number; start: number; end: number }[] = [];
  for (let i = 1; i < frames.length; i++) {
    const id = frames[i].recordingSegment;
    if (!id) continue;
    const last = groups.at(-1);
    if (last?.id === id && last.end === i - 1) last.end = i;
    else groups.push({ id, start: i - 1, end: i });
  }
  return groups;
}

export function retimeAnimation(
  clip: Clip,
  range: AnimationRange,
  mode: AnimationDragMode,
  delta: number,
  fps: number,
): Clip {
  if (!Number.isFinite(delta) || delta === 0) return clip;
  const frames = [...clip.keyframes].sort((a, b) => a.time - b.time);
  if (frames[0]?.time > 0) frames.unshift({ time: 0, value: clip.transform });
  const offset = clip.animationOffset ?? 0,
    minimum = 1 / fps;
  if (frames.length > 10000) return clip;
  const groups = recordingSegments(frames);
  const group = groups.find(
    (group) =>
      Math.max(0, frames[group.start].time - offset) === range.start &&
      Math.min(clip.duration, frames[group.end].time - offset) === range.end,
  );
  if (group && group.end > group.start + 1) {
    const a = frames[group.start].time,
      b = frames[group.end].time;
    const previousGroup = groups.find(
      (candidate) => candidate.end === group.start,
    );
    const nextGroup = groups.find((candidate) => candidate.start === group.end);
    const snap = (time: number) =>
      Math.round((time - offset + clip.start) * fps) / fps +
      offset -
      clip.start;
    const low = Math.max(
      offset,
      previousGroup
        ? frames[previousGroup.start].time + minimum
        : frames[group.start - 1]?.time + minimum || offset,
    );
    const high = Math.min(
      offset + clip.duration,
      nextGroup
        ? frames[nextGroup.end].time - minimum
        : frames[group.end + 1]?.time - minimum || offset + clip.duration,
    );
    if (high - low < minimum) return clip;
    let start = a,
      end = b;
    if (mode === "move") {
      if (high - b < low - a) return clip;
      const shift = Math.max(
        low - a,
        Math.min(high - b, Math.round(delta * fps) / fps),
      );
      start += shift;
      end += shift;
    } else if (mode === "start" && range.hasStart)
      start = Math.max(low, Math.min(b - minimum, snap(a + delta)));
    else if (mode === "end" && range.hasEnd)
      end = Math.max(a + minimum, Math.min(high, snap(b + delta)));
    if (start === a && end === b) return clip;
    return {
      ...clip,
      keyframes: frames.map((frame, index) =>
        index >= group.start && index <= group.end
          ? {
              ...frame,
              time: start + ((frame.time - a) / (b - a)) * (end - start),
            }
          : previousGroup && index >= previousGroup.start && index < group.start
            ? {
                ...frame,
                time:
                  frames[previousGroup.start].time +
                  ((frame.time - frames[previousGroup.start].time) /
                    (a - frames[previousGroup.start].time)) *
                    (start - frames[previousGroup.start].time),
              }
            : nextGroup && index > group.end && index <= nextGroup.end
              ? {
                  ...frame,
                  time:
                    end +
                    ((frame.time - b) / (frames[nextGroup.end].time - b)) *
                      (frames[nextGroup.end].time - end),
                }
              : frame,
      ),
    };
  }
  let index = frames.findIndex(
    (frame, i) =>
      i + 1 < frames.length &&
      Math.max(0, frame.time - offset) === range.start &&
      Math.min(clip.duration, frames[i + 1].time - offset) === range.end,
  );
  if (index < 0) return clip;
  // Legacy animations can share a frame. Detach that boundary before retiming
  // so dragging one arrow can create a hold without retiming its neighbour.
  const rotationValue = clip.transform.rotation ?? clip.rotation ?? 0;
  if (
    mode !== "end" &&
    index > 0 &&
    (frames[index].animation ||
      !sameTransform(
        frames[index - 1].value,
        frames[index].value,
        rotationValue,
        clip.transform,
      ))
  ) {
    frames.splice(index + 1, 0, { ...frames[index], animation: undefined });
    index++;
  }
  if (
    mode !== "start" &&
    index + 2 < frames.length &&
    (frames[index + 2].animation ||
      !sameTransform(
        frames[index + 1].value,
        frames[index + 2].value,
        rotationValue,
        clip.transform,
      ))
  ) {
    frames.splice(index + 2, 0, { ...frames[index + 1], animation: undefined });
  }
  const a = frames[index],
    b = frames[index + 1];
  const previous = frames[index - 1],
    next = frames[index + 2];
  const clipStart = Math.max(0, offset),
    clipEnd = offset + clip.duration;
  const clamp = (v: number, low: number, high: number) =>
    Math.max(low, Math.min(high, v));
  const snap = (time: number) =>
    Math.round((time - offset + clip.start) * fps) / fps + offset - clip.start;
  let start = a.time,
    end = b.time;
  if (mode === "move") {
    const low = Math.max(
      clipStart - a.time,
      previous
        ? previous.time + (previous.time === a.time ? 0 : minimum) - a.time
        : -Infinity,
    );
    const high = Math.min(
      clipEnd - b.time,
      next
        ? next.time - (next.time === b.time ? 0 : minimum) - b.time
        : Infinity,
    );
    if (high < low) return clip;
    const shift = clamp(Math.round(delta * fps) / fps, low, high);
    start += shift;
    end += shift;
  } else if (mode === "start") {
    const low = Math.max(
      clipStart,
      previous ? previous.time + (previous.time === a.time ? 0 : minimum) : 0,
    );
    const high = Math.min(clipEnd, b.time - minimum);
    if (!range.hasStart || high < low) return clip;
    start = clamp(snap(a.time + delta), low, high);
  } else {
    const low = Math.max(clipStart, a.time + minimum);
    const high = Math.min(
      clipEnd,
      next ? next.time - (next.time === b.time ? 0 : minimum) : Infinity,
    );
    if (!range.hasEnd || high < low) return clip;
    end = clamp(snap(b.time + delta), low, high);
  }
  if (start === a.time && end === b.time) return clip;
  frames[index] = { ...a, time: start };
  frames[index + 1] = { ...b, time: end };
  const visual = visualKeys.some(
    (key) =>
      clip.transform[key] !== undefined ||
      frames.some((frame) => frame.value[key] !== undefined),
  );
  if (visual) {
    const defaults = visualDefaults(clip);
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      frames[i] = {
        ...frame,
        value: {
          ...frame.value,
          ...Object.fromEntries(
            visualKeys.map((key) => [
              key,
              frame.value[key] ?? clip.transform[key] ?? defaults[key],
            ]),
          ),
        },
      };
    }
  }
  if (
    maskKeys.some(
      (key) =>
        clip.transform[key] !== undefined ||
        frames.some((frame) => frame.value[key] !== undefined),
    )
  ) {
    for (let i = 0; i < frames.length; i++)
      frames[i] = {
        ...frames[i],
        value: { ...frames[i].value, ...maskValues(clip, frames[i].value) },
      };
  }
  const axes = optionalTransformKeys.filter(
    (key) =>
      clip.transform[key] !== undefined ||
      (key === "rotation" && clip.rotation !== undefined) ||
      frames.some((frame) => frame.value[key] !== undefined),
  );
  const normalized = axes.length
    ? frames.map((frame) => ({
        ...frame,
        value: normalizeRotationAxes(clip, frame.value, axes),
      }))
    : frames;
  // Moving the first start away from zero should hold its original state before
  // the animation, rather than inventing a transition from the static transform.
  return {
    ...clip,
    transform: index === 0 ? normalized[index].value : clip.transform,
    keyframes: normalized,
  };
}

// Only changing values form an animation. Equal-value keyframes describe a
// hold, so drawing a connecting arrow there would imply motion that never occurs.
export function animationRanges(
  clip: Pick<
    Clip,
    "transform" | "keyframes" | "animationOffset" | "duration" | "rotation"
  >,
): AnimationRange[] {
  const frames = [...clip.keyframes].sort((a, b) => a.time - b.time);
  if (frames[0]?.time > 0) frames.unshift({ time: 0, value: clip.transform });
  const offset = clip.animationOffset ?? 0;
  const ranges: AnimationRange[] = [];
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1],
      b = frames[i];
    const unchanged = sameTransform(
      a.value,
      b.value,
      clip.transform.rotation ?? clip.rotation ?? 0,
      clip.transform,
    );
    if (!(b.time > a.time) || (unchanged && !b.animation)) continue;
    const start = a.time - offset,
      end = b.time - offset;
    if (end <= 0 || start >= clip.duration) continue;
    ranges.push({
      start: Math.max(0, start),
      end: Math.min(clip.duration, end),
      hasStart: start >= 0,
      hasEnd: end <= clip.duration,
    });
    if (
      b.recordingSegment &&
      frames[i + 1]?.recordingSegment === b.recordingSegment
    ) {
      while (
        i + 1 < frames.length &&
        frames[i + 1].recordingSegment === b.recordingSegment
      )
        i++;
      const last = ranges.at(-1)!;
      last.end = Math.min(clip.duration, frames[i].time - offset);
      last.hasEnd = frames[i].time - offset <= clip.duration;
    }
  }
  return ranges;
}
