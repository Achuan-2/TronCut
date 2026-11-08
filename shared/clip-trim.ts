import type { Asset, Clip } from "./model";

export function repeatsMedia(clip: Pick<Clip, "loop" | "recordingRole">) {
  return !!clip.loop || clip.recordingRole === "background";
}

/** Fit an overflowing drawing to a shortened clip without changing split clocks. */
function fitTrimmedDrawing(clip: Clip, duration: number): Clip["drawing"] {
  const drawing = clip.drawing;
  if (
    duration >= clip.duration ||
    !drawing?.enabled ||
    drawing.frozenProgress !== undefined
  )
    return drawing;
  const offset = clip.animationOffset ?? 0;
  const start = drawing.delay - offset;
  const end = start + drawing.duration;
  if (end <= duration || offset + duration <= 0) return drawing;

  // Keep an existing delay when it fits. If the cut removes the entire
  // drawing window, compress the delay along with the drawing instead.
  // For split clips, scale about local zero to retain the initial ink progress.
  const pivot = start < duration ? Math.max(0, start) : Math.max(0, -offset);
  const ratio = (duration - pivot) / (end - pivot);
  return {
    ...drawing,
    delay: Math.max(0, offset + pivot + (start - pivot) * ratio),
    duration: drawing.duration * ratio,
  };
}

/** Looping media is bounded by the project limit rather than the source EOF. */
export function trimClip(
  clip: Clip,
  asset: Asset | undefined,
  edge: "left" | "right",
  wanted: number,
  fps: number,
): Clip {
  const minimum = 1 / fps;
  if (edge === "right") {
    const maxDuration =
      !repeatsMedia(clip) && asset && ["video", "audio"].includes(clip.kind)
        ? ((clip.stitch?.reduce((sum, part) => sum + part.duration, 0) ??
            asset.duration) -
            clip.sourceIn) /
          clip.speed
        : 86400;
    const duration = Math.max(minimum, Math.min(maxDuration, wanted));
    return {
      ...clip,
      duration,
      drawing: fitTrimmedDrawing(clip, duration),
    };
  }
  const sourceBound =
    !repeatsMedia(clip) && ["video", "audio"].includes(clip.kind)
      ? -clip.sourceIn / clip.speed
      : -clip.start;
  const offset = Math.max(
    -clip.start,
    sourceBound,
    clip.duration - 86400,
    Math.min(clip.duration - minimum, wanted),
  );
  let sourceIn = clip.sourceIn + offset * clip.speed;
  if (repeatsMedia(clip) && asset && asset.duration > 0)
    sourceIn = ((sourceIn % asset.duration) + asset.duration) % asset.duration;
  return {
    ...clip,
    start: clip.start + offset,
    duration: clip.duration - offset,
    sourceIn: Math.max(0, sourceIn),
    animationOffset: (clip.animationOffset ?? 0) + offset,
    ...(clip.fadeTiming
      ? {
          fadeTiming: {
            ...clip.fadeTiming,
            offset: clip.fadeTiming.offset + offset,
          },
        }
      : {}),
  };
}
