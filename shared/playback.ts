import { projectDuration, type Project } from "./model";

export type PlaybackDirection = -1 | 1;
const tolerance = 1e-7;

export function stepFrameTime(
  time: number,
  fps: number,
  direction: PlaybackDirection,
  duration: number,
): number {
  const bounded = Math.max(0, Math.min(duration, time));
  const frame =
    direction < 0
      ? Math.ceil(bounded * fps - tolerance) - 1
      : Math.floor(bounded * fps + tolerance) + 1;
  return Math.max(0, Math.min(duration, frame / fps));
}

// Media navigation follows edit boundaries across visible tracks. Equal cuts
// on several tracks are one target, and the current boundary is skipped.
export function mediaBoundaryTime(
  project: Project,
  time: number,
  direction: PlaybackDirection,
): number {
  const duration = projectDuration(project);
  const hidden = new Set(
    project.tracks.filter((track) => track.hidden).map((track) => track.id),
  );
  const boundaries = [
    0,
    duration,
    ...project.clips
      .filter((clip) => !hidden.has(clip.trackId))
      .flatMap((clip) => [clip.start, clip.start + clip.duration]),
  ];
  if (direction < 0)
    return Math.max(
      0,
      ...boundaries.filter((boundary) => boundary < time - tolerance),
    );
  return Math.min(
    duration,
    ...boundaries.filter((boundary) => boundary > time + tolerance),
  );
}
