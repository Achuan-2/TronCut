import { groupedTimeline } from "./clip-groups";
import { trimClip } from "./clip-trim";
import { snapTime } from "./editor";
import type { Asset, Clip, Project } from "./model";
import { timelineTrimBounds } from "./timeline-collision";

/** Resolve the visible edge after source/collision limits, for preview and commit. */
export function trimTimelineClip(
  project: Project,
  clip: Clip,
  asset: Asset | undefined,
  edge: "left" | "right",
  delta: number,
  snapTolerance?: number,
): Clip {
  const collision = timelineTrimBounds(project, clip.id);
  const edgeTime = (value: Clip) =>
    edge === "left" ? value.start : value.start + value.duration;
  const trimAt = (time: number) =>
    trimClip(
      clip,
      asset,
      edge,
      edge === "left"
        ? Math.max(time, collision.start) - clip.start
        : Math.min(time, collision.end) - clip.start,
      project.canvas.fps,
    );
  const bounded = trimAt(edgeTime(clip) + delta);
  if (snapTolerance === undefined) return bounded;

  // Hidden recording layers move with their master and must not attract its edge.
  // Discard unreachable targets so they cannot mask another nearby, valid edge.
  const time = snapTime(
    edgeTime(bounded),
    { ...project, clips: groupedTimeline(project).clips },
    clip.id,
    snapTolerance,
    { start: edgeTime(trimAt(-Infinity)), end: edgeTime(trimAt(Infinity)) },
  );
  return trimAt(time);
}
