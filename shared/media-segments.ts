import type { Clip } from "./model";

export interface MediaSegment {
  sourceIn: number;
  /** Duration before clip speed; frozen ranges advance only the virtual clock. */
  duration: number;
  /** Start in local timeline seconds. */
  start: number;
  freeze?: true;
}

/** Visible source ranges, including trimmed and speed-adjusted stitched clips. */
export function mediaSegments(clip: Clip): MediaSegment[] {
  if (!clip.stitch)
    return [
      {
        sourceIn: clip.sourceIn,
        duration: clip.duration * clip.speed,
        start: 0,
      },
    ];
  const end = clip.sourceIn + clip.duration * clip.speed;
  let cursor = 0;
  const result: MediaSegment[] = [];
  for (const part of clip.stitch) {
    const from = Math.max(cursor, clip.sourceIn);
    const to = Math.min(cursor + part.duration, end);
    if (to - from > 1e-8)
      result.push({
        sourceIn: part.sourceIn + (part.freeze ? 0 : from - cursor),
        duration: to - from,
        start: (from - clip.sourceIn) / clip.speed,
        ...(part.freeze ? { freeze: true as const } : {}),
      });
    cursor += part.duration;
    if (cursor >= end - 1e-8) break;
  }
  return result;
}

export function sourceTimeAt(clip: Clip, localTime: number): number {
  if (!clip.stitch) return clip.sourceIn + localTime * clip.speed;
  const segments = mediaSegments(clip);
  const local = Math.max(0, Math.min(clip.duration, localTime));
  const part = segments.find(
    (part, index) =>
      index === segments.length - 1 ||
      local < part.start + part.duration / clip.speed - 1e-8,
  );
  return part
    ? part.sourceIn +
      (part.freeze ? 0 : Math.max(0, local - part.start) * clip.speed)
    : 0;
}

export function frozenAt(clip: Clip, localTime: number): boolean {
  if (!clip.stitch) return false;
  return mediaSegments(clip).some((part) =>
    part.freeze && localTime >= part.start - 1e-8 &&
    localTime < part.start + part.duration / clip.speed - 1e-8,
  );
}

export function stitchBoundaries(clip: Clip): number[] {
  return clip.stitch
    ? mediaSegments(clip)
        .filter((part, index, parts) =>
          index > 0 && !part.freeze && !parts[index - 1].freeze,
        )
        .map((part) => part.start)
    : [];
}

/** Drop invisible ranges after splitting and restore ordinary clips at the ends. */
export function normalizeStitch(clip: Clip): Clip {
  if (!clip.stitch) return clip;
  const segments = mediaSegments(clip).map(({ sourceIn, duration, freeze }) => ({
    sourceIn,
    duration,
    ...(freeze ? { freeze } : {}),
  }));
  return segments.length === 1 && !segments[0].freeze
    ? { ...clip, sourceIn: segments[0].sourceIn, stitch: undefined }
    : { ...clip, sourceIn: 0, stitch: segments };
}
