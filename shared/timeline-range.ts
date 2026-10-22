import type { Project } from "./model";
import { editableIds, splitSelection } from "./timeline";
import { stitchClipsAtTime } from "./stitch";

export interface TimelineRange {
  start: number;
  end: number;
}

export function normalizeTimelineRange(
  start: number,
  end: number,
  fps: number,
): TimelineRange | null {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const from = Math.max(0, Math.round(Math.min(start, end) * fps) / fps);
  const to = Math.max(0, Math.round(Math.max(start, end) * fps) / fps);
  return to - from >= 1 / fps - 1e-8 ? { start: from, end: to } : null;
}

/** Excise a shared interval on every editable track, then optionally close that exact time. */
export function deleteTimelineRange(
  project: Project,
  range: TimelineRange,
  ripple = false,
  autoStitch = false,
): Project {
  const normalized = normalizeTimelineRange(
    range.start,
    range.end,
    project.canvas.fps,
  );
  if (!normalized) return project;
  const next = exciseTimelineRange(project, normalized, ripple);
  return next !== project && ripple && autoStitch
    ? stitchClipsAtTime(next, normalized.start)
    : next;
}

/** Preserve exact placement boundaries when another clip overwrites this interval. */
export function exciseTimelineRange(
  project: Project,
  { start, end }: TimelineRange,
  ripple = false,
): Project {
  if (
    !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start
  )
    return project;
  const originalIds = project.clips.map((clip) => clip.id);
  const editable = editableIds(project, originalIds);
  const affected = project.clips.some(
    (clip) =>
      editable.has(clip.id) &&
      (ripple
        ? clip.start + clip.duration > start
        : clip.start < end && clip.start + clip.duration > start),
  );
  if (!affected) return project;
  // Keep effect clocks anchored to the source when the deletion creates new edges.
  const prepared = {
    ...project,
    clips: project.clips.map((clip) =>
      editable.has(clip.id) &&
      clip.start < end &&
      clip.start + clip.duration > start
        ? {
            ...clip,
            behaviors: clip.behaviors?.map((behavior) => ({
              ...behavior,
              preserveTiming: true,
            })),
            ...((clip.fadeIn ?? 0) > 0 || (clip.fadeOut ?? 0) > 0
              ? {
                  fadeTiming: clip.fadeTiming ?? {
                    offset: 0,
                    duration: clip.duration,
                  },
                }
              : {}),
          }
        : clip,
    ),
  };
  const splitAt = (project: Project, time: number) => {
    // Only boundary-crossing clips need splitting; later clips need no source edits.
    const ids = project.clips
      .filter((clip) => clip.start < time && clip.start + clip.duration > time)
      .map((clip) => clip.id);
    return ids.length ? splitSelection(project, ids, time) : project;
  };
  const next = splitAt(splitAt(prepared, start), end);
  const finalIds = editableIds(
    next,
    next.clips.map((clip) => clip.id),
  );
  const clips = next.clips.filter(
    (clip) =>
      !finalIds.has(clip.id) ||
      clip.start >= end - 1e-8 ||
      clip.start + clip.duration <= start + 1e-8,
  );
  const shift = (time: number) =>
    time <= start ? time : time < end ? start : time - (end - start);
  return {
    ...next,
    clips: ripple
      ? clips.map((clip) =>
          finalIds.has(clip.id) && clip.start >= end - 1e-8
            ? { ...clip, start: shift(clip.start) }
            : clip,
        )
      : clips,
    markers: ripple
      ? next.markers.map((marker) => ({
          ...marker,
          time: shift(marker.time),
          ...(marker.duration === undefined
            ? {}
            : {
                duration:
                  shift(marker.time + marker.duration) - shift(marker.time),
              }),
        }))
      : next.markers,
  };
}
