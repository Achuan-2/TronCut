import { type Clip, type Project } from "./model";
import { splitClip } from "./editor";
import { mediaSegments, stitchBoundaries } from "./media-segments";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  return value;
}

function selection(project: Project, ids: readonly string[]) {
  const selected = new Set(ids);
  return project.clips
    .filter((clip) => selected.has(clip.id))
    .sort((a, b) => a.start - b.start);
}

// A stitch shares one set of editable properties. Refuse incompatible inputs
// instead of silently overwriting independent edits on later pieces.
function appearance(clip: Clip) {
  const {
    id,
    name,
    start,
    duration,
    sourceIn,
    stitch,
    animationOffset,
    keyframes,
    transitions,
    fadeIn,
    fadeOut,
    ...properties
  } = clip;
  return JSON.stringify(canonical(properties));
}

export function stitchSelectionError(
  project: Project,
  ids: readonly string[],
): string | null {
  const clips = selection(project, ids);
  if (clips.length < 2) return "请选择至少两个相邻片段";
  const first = clips[0];
  if (
    clips.some(
      (clip) =>
        project.tracks.find((track) => track.id === clip.trackId)?.locked,
    )
  )
    return "锁定轨道上的片段不能拼接";
  if (
    clips.some(
      (clip) =>
        clip.trackId !== first.trackId ||
        clip.assetId !== first.assetId ||
        clip.kind !== first.kind ||
        !["video", "audio"].includes(clip.kind) ||
        clip.loop ||
        clip.groupId ||
        clip.recording,
    )
  )
    return "请选择同一轨道、同一音视频素材的片段；组合请先解组";
  if (
    clips.some(
      (clip, index) =>
        index > 0 &&
        Math.abs(
          clips[index - 1].start + clips[index - 1].duration - clip.start,
        ) > 1e-6,
    )
  )
    return "片段之间有空隙或重叠，请先使它们首尾相接";
  const original = appearance(first);
  if (
    clips.some(
      (clip) =>
        appearance(clip) !== original ||
        JSON.stringify(canonical(clip.keyframes)) !==
          JSON.stringify(canonical(first.keyframes)) ||
        (clip.keyframes.length > 0 &&
          Math.abs(
            (clip.animationOffset ?? 0) -
              (first.animationOffset ?? 0) -
              (clip.start - first.start),
          ) > 1e-6),
    )
  )
    return "片段的速度、动画或属性不同，请先统一后再拼接";
  if (
    clips.some(
      (clip, index) =>
        (index > 0 && ((clip.fadeIn ?? 0) > 0 || clip.transitions?.incoming)) ||
        (index < clips.length - 1 &&
          ((clip.fadeOut ?? 0) > 0 || clip.transitions?.outgoing)),
    )
  )
    return "请先移除片段内部接缝的淡入淡出或转场";
  if (
    clips.reduce((sum, clip) => sum + clip.duration, 0) > 86400 ||
    clips.reduce((sum, clip) => sum + mediaSegments(clip).length, 0) > 10000
  )
    return "拼接后的时长或分段数超出工程限制";
  return null;
}

export function stitchClips(project: Project, ids: readonly string[]): Project {
  if (stitchSelectionError(project, ids)) return project;
  const clips = selection(project, ids);
  const first = clips[0],
    last = clips.at(-1)!;
  const selected = new Set(ids);
  const merged: Clip = {
    ...first,
    duration: clips.reduce((sum, clip) => sum + clip.duration, 0),
    sourceIn: 0,
    stitch: clips.flatMap((clip) =>
      mediaSegments(clip).map(({ sourceIn, duration }) => ({
        sourceIn,
        duration,
      })),
    ),
    fadeOut: last.fadeOut,
    transitions: {
      incoming: first.transitions?.incoming,
      outgoing: last.transitions?.outgoing,
    },
  };
  return {
    ...project,
    clips: project.clips.flatMap((clip) =>
      clip.id === first.id ? [merged] : selected.has(clip.id) ? [] : [clip],
    ),
  };
}

/** Remove one seam or all seams, retaining the current animation and source cuts. */
export function unstitchClips(
  project: Project,
  ids: readonly string[],
  seam?: number,
): Project {
  let result = project;
  for (const id of ids) {
    const clip = result.clips.find((clip) => clip.id === id);
    if (
      !clip ||
      project.tracks.find((track) => track.id === clip.trackId)?.locked
    )
      continue;
    const cuts = stitchBoundaries(clip).filter(
      (time) => seam === undefined || Math.abs(time - seam) < 1e-6,
    );
    if (!cuts.length) continue;
    // Split from the end so the original ID always addresses the unsplit prefix.
    for (const cut of cuts.reverse())
      result = splitClip(result, id, clip.start + cut);
  }
  return result;
}
