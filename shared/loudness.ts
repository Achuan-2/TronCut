import type { Clip, Project } from "./model";

export const normalizedLoudness = -18;
export const normalizedTruePeak = -1.5;

export function normalizesClip(project: Project, clip: Clip) {
  return (
    project.audio?.autoNormalizeLoudness === true &&
    clip.autoNormalizeLoudness !== false &&
    !clip.audioDetached &&
    (clip.kind === "video" || clip.kind === "audio")
  );
}

export function normalizationKey(clip: Clip) {
  return `${clip.assetId}:${clip.podcast ? "podcast" : "original"}`;
}
