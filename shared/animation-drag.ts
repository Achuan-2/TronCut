import type { Project } from "./model";
import { addAnimationKeyframe } from "./animation-edit";
import { animationRanges } from "./animation-ranges";
import { editableCanvasIds } from "./canvas-actions";
import { recordingMaster } from "./recording-objects";
import { isTrackActive } from "./tracks";

export const animationMime = "troncut-animation";
export const customAnimationId = "custom";

/** A drop uses the same end-at-playhead rule as the Add Animation button. */
export function animationDropTarget(
  project: Project,
  clipId: string,
  time: number,
  duration: number,
) {
  if (!Number.isFinite(time)) return null;
  const id = recordingMaster(project, clipId)?.id ?? clipId;
  const clip = project.clips.find((clip) => clip.id === id);
  if (
    !clip ||
    !isTrackActive(project.tracks, clip.trackId) ||
    !editableCanvasIds(project, [id]).has(id) ||
    time < clip.start ||
    time > clip.start + clip.duration
  )
    return null;
  const snapped = Math.max(
    clip.start,
    Math.min(
      clip.start + clip.duration,
      Math.round(time * project.canvas.fps) / project.canvas.fps,
    ),
  );
  const result = addAnimationKeyframe(
    clip,
    snapped - clip.start,
    project.canvas.fps,
    duration,
  );
  if (!result) return null;
  const range = animationRanges(result.clip).find(
    (range) => Math.abs(range.end - result.time) < 1e-6,
  );
  if (!range) return null;
  return {
    clipId: id,
    result,
    start: clip.start + range.start,
    end: clip.start + range.end,
  };
}
