import type { Asset, Clip } from "./model";

export function repeatsMedia(clip: Pick<Clip, "loop" | "recordingRole">) {
  return !!clip.loop || clip.recordingRole === "background";
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
    return {
      ...clip,
      duration: Math.max(minimum, Math.min(maxDuration, wanted)),
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
