import type { Clip, Project } from "./model";
import { mediaSegments, normalizeStitch, sourceTimeAt } from "./media-segments";
import { editableIds, selectionWithGroups } from "./timeline";
import { hasProjectTimelineOverlap } from "./timeline-collision";

export function frameExtensions(clip: Clip) {
  return mediaSegments(clip)
    .filter((part) => part.freeze)
    .map((part) => ({ ...part, duration: part.duration / clip.speed }));
}

export function frameExtensionAt(clip: Clip, local: number) {
  return frameExtensions(clip).find(
    (part) =>
      local >= part.start - 1e-8 && local < part.start + part.duration - 1e-8,
  );
}

/** Edit the virtual source stream; no images or temporary media are generated. */
function extensionResult(
  project: Project,
  id: string,
  local: number,
  seconds: number,
) {
  const clip = project.clips.find((clip) => clip.id === id);
  if (!clip || clip.kind !== "video") return { error: "请选择视频片段" };
  const asset = project.assets.find((asset) => asset.id === clip.assetId);
  if (!asset || asset.missing || asset.duration <= 0)
    return { error: "请先更新离线素材" };
  if (!editableIds(project, [id]).has(id)) return { error: "请先解锁片段轨道" };
  if (clip.groupId) return { error: "请先打开组，再编辑组内视频" };
  if (clip.loop) return { error: "请先关闭视频循环" };
  if (!Number.isFinite(local) || local < 0 || local >= clip.duration)
    return { error: "请将播放头移到视频片段内" };
  const existing = frameExtensionAt(clip, local);
  const duration =
    Math.round(seconds * project.canvas.fps) / project.canvas.fps;
  if (
    !Number.isFinite(duration) ||
    duration < 0 ||
    (duration === 0 && (!existing || seconds > 0))
  )
    return { error: "请输入至少一帧的持续时间" };
  const delta = duration - (existing?.duration ?? 0);
  if (Math.abs(delta) < 1e-8) return { project };
  if (clip.duration + delta > 86400)
    return { error: "片段总时长不能超过 24 小时" };
  const parts = mediaSegments(clip);
  const ranges: NonNullable<Clip["stitch"]> = [];
  const append = (part: (typeof parts)[number], length: number, offset = 0) => {
    if (length <= 1e-8) return;
    const next = {
      sourceIn: part.sourceIn + (part.freeze ? 0 : offset),
      duration: length,
      ...(part.freeze ? { freeze: true as const } : {}),
    };
    const previous = ranges.at(-1);
    if (
      previous &&
      !previous.freeze &&
      !next.freeze &&
      Math.abs(previous.sourceIn + previous.duration - next.sourceIn) < 1e-8
    )
      previous.duration += next.duration;
    else ranges.push(next);
  };
  const at =
    existing?.start ??
    Math.max(
      0,
      Math.min(
        clip.duration - 1 / project.canvas.fps,
        Math.max(
          0,
          Math.round(local * project.canvas.fps) / project.canvas.fps,
        ),
      ),
    );
  for (const part of parts) {
    if (existing && Math.abs(part.start - existing.start) < 1e-8) {
      append(part, duration * clip.speed);
    } else if (
      !existing &&
      at >= part.start - 1e-8 &&
      at < part.start + part.duration / clip.speed - 1e-8
    ) {
      const before = Math.max(0, (at - part.start) * clip.speed);
      append(part, before);
      ranges.push({
        sourceIn: Math.min(asset.duration - 1e-6, sourceTimeAt(clip, at)),
        duration: duration * clip.speed,
        freeze: true,
      });
      append(part, part.duration - before, before);
    } else append(part, part.duration);
  }
  if (ranges.length > 10000) return { error: "片段分段数超出工程限制" };
  // Preserve any following groups as a whole when making room on this track.
  const following = selectionWithGroups(
    project,
    project.clips
      .filter(
        (other) =>
          other.id !== id &&
          other.trackId === clip.trackId &&
          other.start >= clip.start + clip.duration - 1e-8,
      )
      .map((clip) => clip.id),
  );
  const editable = editableIds(project, following);
  if (following.some((id) => !editable.has(id)))
    return { error: "后续组合包含锁定轨道，无法顺延" };
  const shifted = new Set(following);
  const result = {
    ...project,
    clips: project.clips.flatMap((other) =>
      other.id === id
        ? ranges.length
          ? [
              normalizeStitch({
                ...clip,
                sourceIn: 0,
                duration: clip.duration + delta,
                stitch: ranges,
              }),
            ]
          : []
        : [
            shifted.has(other.id)
              ? { ...other, start: other.start + delta }
              : other,
          ],
    ),
  };
  if (hasProjectTimelineOverlap(result))
    return { error: "扩展后会与其他素材重叠，请先调整位置" };
  return { project: result };
}

export function frameExtensionError(
  project: Project,
  id: string,
  local: number,
  seconds: number,
) {
  return extensionResult(project, id, local, seconds).error ?? null;
}

export function setFrameExtension(
  project: Project,
  id: string,
  local: number,
  seconds: number,
): Project {
  return extensionResult(project, id, local, seconds).project ?? project;
}
