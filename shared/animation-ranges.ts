import type { Clip, Transform } from "./model";
import {
  normalizeRotationAxes,
  optionalTransformKeys,
  axisScaleKeys,
} from "./rotation";
import { visualKeys, visualDefaults } from "./visual-state";
import { maskKeys, maskDefaults, maskValues } from "./mask-state";
import { recordingMotionSpans, type RecordingMotion } from "./recording-motion";
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

/** Retain animation endpoints, not standalone frames left in static intervals.
 * Equal endpoints of explicitly added animations are still real boundaries.
 */
export function compactAnimationFrames<
  T extends Pick<Clip, "transform" | "keyframes"> & Partial<Pick<Clip, "rotation">>,
>(clip: T): T {
  if (!clip.keyframes.length) return clip;
  // Recorded paths and zoom/pan carry additional sampled channels. Their
  // intermediate samples belong to the path, even when object values match.
  if (
    clip.keyframes.some(
      (frame) => frame.recordingZoom || frame.recordingSegment || frame.zoomPan,
    )
  )
    return clip;
  const frames = [...clip.keyframes].sort((a, b) => a.time - b.time);
  const points =
    frames[0].time > 0
      ? [{ time: 0, value: clip.transform }, ...frames]
      : frames;
  const endpoints = new Set<number>();
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    const unchanged = sameTransform(
      a.value,
      b.value,
      clip.transform.rotation ?? clip.rotation ?? 0,
      clip.transform,
    );
    // Coincident, different states describe a legacy discontinuity, not a hold.
    if (b.time === a.time && !unchanged) return clip;
    if (b.time > a.time && (b.animation || !unchanged)) {
      endpoints.add(i - 1);
      endpoints.add(i);
    }
  }
  const keyframes = points.filter((_, index) => endpoints.has(index));
  if (
    keyframes.length === clip.keyframes.length &&
    keyframes.every((frame, index) => frame === clip.keyframes[index])
  )
    return clip;
  return {
    ...clip,
    // If a redundant first frame supplied the initial state, keep that state
    // on the clip before removing it. This also preserves trimmed timelines.
    transform: endpoints.has(0)
      ? clip.transform
      : { ...clip.transform, ...points[0].value },
    keyframes,
  };
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

/** A hold after an animation belongs to its end pose. Do not target an older
 * endpoint while the playhead is inside a later animation or outside the clip.
 * Input uses clip-local time; the returned time uses the keyframe clock.
 */
export function heldAnimationEndpoint(clip: Clip, localTime: number) {
  if (!Number.isFinite(localTime) || localTime < 0 || localTime > clip.duration)
    return null;
  const ranges = animationRanges(clip);
  if (
    ranges.some(
      (range) =>
        localTime > range.start + 1e-6 &&
        (localTime < range.end - 1e-6 || !range.hasEnd),
    )
  )
    return null;
  const previous = ranges
    .filter((range) => range.hasEnd && range.end <= localTime + 1e-6)
    .at(-1);
  return previous
    ? { time: previous.end + (clip.animationOffset ?? 0), side: "end" as const }
    : null;
}

export interface AnimationRange {
  start: number;
  end: number;
  hasStart: boolean;
  hasEnd: boolean;
  motion?: RecordingMotion;
  kind?: "drawing";
}

// Clips are immutable snapshots in the editor. Playback requests the same
// ranges every frame, so retain them with the clip object and let GC evict old
// edits automatically.
const transformRangeCache = new WeakMap<
  object,
  {
    keyframes: unknown;
    transform: unknown;
    animationOffset: number;
    duration: number;
    rotation?: number;
    ranges: AnimationRange[];
  }
>();
const drawingRangeCache = new WeakMap<
  object,
  {
    drawing: unknown;
    animationOffset: number;
    duration: number;
    ranges: AnimationRange[];
  }
>();

/** Drawing is an independent animation channel and may overlap transforms. */
export function drawingAnimationRanges(
  clip: Pick<Clip, "drawing" | "animationOffset" | "duration">,
): AnimationRange[] {
  const offset = clip.animationOffset ?? 0;
  const cached = drawingRangeCache.get(clip);
  if (
    cached &&
    cached.drawing === clip.drawing &&
    cached.animationOffset === offset &&
    cached.duration === clip.duration
  )
    return cached.ranges;
  const drawing = clip.drawing;
  if (!drawing?.enabled || drawing.frozenProgress !== undefined) {
    drawingRangeCache.set(clip, {
      drawing: clip.drawing,
      animationOffset: offset,
      duration: clip.duration,
      ranges: [],
    });
    return [];
  }
  const start = drawing.delay - offset;
  const end = start + drawing.duration;
  if (end <= 0 || start >= clip.duration) {
    drawingRangeCache.set(clip, {
      drawing: clip.drawing,
      animationOffset: offset,
      duration: clip.duration,
      ranges: [],
    });
    return [];
  }
  const ranges: AnimationRange[] = [
    {
      kind: "drawing",
      start: Math.max(0, start),
      end: Math.min(clip.duration, end),
      hasStart: start >= 0,
      hasEnd: end <= clip.duration,
    },
  ];
  drawingRangeCache.set(clip, {
    drawing: clip.drawing,
    animationOffset: offset,
    duration: clip.duration,
    ranges,
  });
  return ranges;
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
  const groups: {
    id: number;
    start: number;
    end: number;
    motion?: RecordingMotion;
  }[] = [];
  for (let i = 1; i < frames.length; i++) {
    const id = frames[i].recordingSegment;
    if (!id) continue;
    const last = groups.at(-1);
    if (last?.id === id && last.end === i - 1) last.end = i;
    else
      groups.push({
        id,
        start: i - 1,
        end: i,
        motion: frames[i].recordingMotion,
      });
  }
  return groups.flatMap((group) => {
    // New paths carry explicit phase boundaries, and pasted animations keep
    // their user-defined range. Reinterpret legacy two-arrow shots read-only.
    if (frames[group.end].animation || frames[group.end].recordingMotion)
      return [group];
    const samples = frames.slice(group.start, group.end + 1).map((frame) => ({
      time: frame.time,
      x: frame.value.contentX ?? frame.value.x,
      y: frame.value.contentY ?? frame.value.y,
      scale: frame.value.contentScale ?? frame.value.scale,
    }));
    return recordingMotionSpans(samples)
      .filter((span) => span.motion)
      .map((span) => ({
        id: group.id,
        start: group.start + span.start,
        end: group.start + span.end,
        motion: span.motion,
      }));
  });
}

export function retimeAnimation(
  clip: Clip,
  range: AnimationRange,
  mode: AnimationDragMode,
  delta: number,
  fps: number,
): Clip {
  if (!Number.isFinite(delta) || delta === 0) return clip;
  if (range.kind === "drawing") {
    const drawing = clip.drawing;
    if (!drawing || !Number.isFinite(fps) || fps <= 0) return clip;
    const offset = clip.animationOffset ?? 0;
    const minimum = Math.min(1 / fps, clip.duration);
    const a = drawing.delay - offset,
      b = a + drawing.duration;
    const snap = (time: number) =>
      Math.round((time + clip.start) * fps) / fps - clip.start;
    let start = a,
      end = b;
    if (mode === "move") {
      const low = Math.max(0, -offset) - a,
        high = clip.duration - b;
      if (high < low) return clip;
      const shift = Math.max(
        low,
        Math.min(high, Math.round(delta * fps) / fps),
      );
      start += shift;
      end += shift;
    } else if (mode === "start" && range.hasStart) {
      const low = Math.max(0, -offset),
        high = Math.min(clip.duration, b - minimum);
      if (high < low) return clip;
      start = Math.max(low, Math.min(high, snap(a + delta)));
    } else if (mode === "end" && range.hasEnd) {
      const low = Math.max(0, a + minimum);
      if (low > clip.duration) return clip;
      end = Math.max(low, Math.min(clip.duration, snap(b + delta)));
    }
    return start === a && end === b
      ? clip
      : {
          ...clip,
          drawing: {
            ...drawing,
            delay: Math.max(0, start + offset),
            duration: end - start,
          },
        };
  }
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
  const offset = clip.animationOffset ?? 0;
  const cached = transformRangeCache.get(clip);
  if (
    cached &&
    cached.keyframes === clip.keyframes &&
    cached.transform === clip.transform &&
    cached.animationOffset === offset &&
    cached.duration === clip.duration &&
    cached.rotation === clip.rotation
  )
    return cached.ranges;
  const frames = [...clip.keyframes].sort((a, b) => a.time - b.time);
  if (frames[0]?.time > 0) frames.unshift({ time: 0, value: clip.transform });
  const ranges: AnimationRange[] = [];
  const groups = new Map(
    recordingSegments(frames).map((group) => [group.start + 1, group]),
  );
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1],
      b = frames[i];
    const group = groups.get(i);
    if (b.recordingZoom && !group && !b.animation) continue;
    const unchanged = sameTransform(
      a.value,
      b.value,
      clip.transform.rotation ?? clip.rotation ?? 0,
      clip.transform,
    );
    if (!(b.time > a.time) || (unchanged && !b.animation && !group)) continue;
    if (group) i = group.end;
    const start = a.time - offset,
      end = frames[i].time - offset;
    if (end <= 0 || start >= clip.duration) continue;
    ranges.push({
      start: Math.max(0, start),
      end: Math.min(clip.duration, end),
      hasStart: start >= 0,
      hasEnd: end <= clip.duration,
      ...(group?.motion ? { motion: group.motion } : {}),
    });
  }
  transformRangeCache.set(clip, {
    keyframes: clip.keyframes,
    transform: clip.transform,
    animationOffset: offset,
    duration: clip.duration,
    rotation: clip.rotation,
    ranges,
  });
  return ranges;
}
