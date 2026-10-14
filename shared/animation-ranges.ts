import type { Clip, Transform } from "./model";

export function sameTransform(a: Transform, b: Transform, rotation = 0) {
  return (
    (["x", "y", "scale", "opacity"] as const).every(
      (key) => Math.abs(a[key] - b[key]) < 1e-9,
    ) && Math.abs((a.rotation ?? rotation) - (b.rotation ?? rotation)) < 1e-9
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

export type AnimationDragMode = "start" | "end" | "move";

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
    !sameTransform(frames[index - 1].value, frames[index].value, rotationValue)
  ) {
    frames.splice(index, 0, { ...frames[index] });
    index++;
  }
  if (
    mode !== "start" &&
    index + 2 < frames.length &&
    !sameTransform(
      frames[index + 1].value,
      frames[index + 2].value,
      rotationValue,
    )
  ) {
    frames.splice(index + 2, 0, { ...frames[index + 1] });
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
  const rotation = clip.transform.rotation ?? clip.rotation ?? 0;
  const hasRotation =
    clip.rotation !== undefined ||
    frames.some((frame) => frame.value.rotation !== undefined);
  const normalized = hasRotation
    ? frames.map((frame) => ({
        ...frame,
        value: {
          ...frame.value,
          rotation: frame.value.rotation ?? rotation,
        },
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
    );
    if (!(b.time > a.time) || unchanged) continue;
    const start = a.time - offset,
      end = b.time - offset;
    if (end <= 0 || start >= clip.duration) continue;
    ranges.push({
      start: Math.max(0, start),
      end: Math.min(clip.duration, end),
      hasStart: start >= 0,
      hasEnd: end <= clip.duration,
    });
  }
  return ranges;
}
