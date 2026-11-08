import type { Clip, Project } from "./model";
import { mediaSegments, normalizeStitch, sourceTimeAt } from "./media-segments";
import { editableIds, selectionWithGroups } from "./timeline";
import {
  hasProjectTimelineOverlap,
  timelineRangesOverlap,
} from "./timeline-collision";
import { recordingMaster } from "./recording-objects";
import { transformAt } from "./editor";

export type FrameExtensionPosition = "playhead" | "start" | "end";

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

/** Opening the dialog must also work when the playhead is outside the clip. */
export function frameExtensionTargetError(
  project: Project,
  id: string,
): string | null {
  const clip = project.clips.find((clip) => clip.id === id);
  if (!clip || clip.kind !== "video") return "请选择视频片段";
  const asset = project.assets.find((asset) => asset.id === clip.assetId);
  if (!asset || asset.missing || asset.duration <= 0) return "请先更新离线素材";
  if (!editableIds(project, [id]).has(id)) return "请先解锁片段轨道";
  const recording = recordingMaster(project, id);
  if (clip.groupId && recording?.id !== id) return "请先打开组，再编辑组内视频";
  if (
    recording &&
    project.clips.some((member) => {
      if (member.groupId !== recording.groupId) return false;
      const source = project.assets.find(
        (asset) => asset.id === member.assetId,
      );
      return (
        !source ||
        source.missing ||
        (member.kind !== "image" && source.duration <= 0)
      );
    })
  )
    return "请先更新离线素材";
  if (clip.loop) return "请先关闭视频循环";
  return null;
}

/** Splice a hold into a media stream, including a recording's separate audio. */
function extendMedia(
  clip: Clip,
  assetDuration: number,
  at: number,
  previousDuration: number,
  duration: number,
  fps: number,
): Clip | null {
  const ranges: NonNullable<Clip["stitch"]> = [];
  const append = (part: NonNullable<Clip["stitch"]>[number]) => {
    if (part.duration <= 1e-8) return;
    const previous = ranges.at(-1);
    if (
      previous &&
      !previous.freeze &&
      !part.freeze &&
      Math.abs(previous.sourceIn + previous.duration - part.sourceIn) < 1e-8
    )
      previous.duration += part.duration;
    else ranges.push(part);
  };
  const parts = mediaSegments(clip);
  const slice = (from: number, to: number) => {
    for (const part of parts) {
      const start = Math.max(from, part.start);
      const end = Math.min(to, part.start + part.duration / clip.speed);
      if (end - start <= 1e-8) continue;
      append({
        sourceIn:
          part.sourceIn + (part.freeze ? 0 : (start - part.start) * clip.speed),
        duration: (end - start) * clip.speed,
        ...(part.freeze ? { freeze: true as const } : {}),
      });
    }
  };
  slice(0, at);
  if (duration > 0) {
    const lastFrame = Math.max(0, (Math.ceil(clip.duration * fps) - 1) / fps);
    append({
      sourceIn: Math.min(
        assetDuration - 1e-6,
        sourceTimeAt(clip, Math.min(at, lastFrame)),
      ),
      duration: duration * clip.speed,
      freeze: true,
    });
  }
  slice(at + previousDuration, clip.duration);
  return ranges.length
    ? normalizeStitch({
        ...clip,
        sourceIn: 0,
        duration: clip.duration + duration - previousDuration,
        stitch: ranges,
      })
    : null;
}

/** Hold recorded zoom/pan with the picture and resume the remaining path. */
function extendRecordingAnimation(
  clip: Clip,
  at: number,
  previousDuration: number,
  duration: number,
  fps: number,
): Pick<Clip, "keyframes" | "animationOffset"> {
  if (!clip.keyframes.length) return { keyframes: clip.keyframes };
  // Rebase only negative animation clocks so the inserted endpoints remain valid.
  const rebase = Math.min(0, at + (clip.animationOffset ?? 0));
  const offset = (clip.animationOffset ?? 0) - rebase;
  const start = at + offset;
  const end = start + previousDuration;
  const frames = clip.keyframes.map((frame) => ({
    ...frame,
    time: frame.time - rebase,
  }));
  const lastFrame = Math.max(0, (Math.ceil(clip.duration * fps) - 1) / fps);
  const sampleAt = Math.min(at, lastFrame);
  const value = transformAt(clip, sampleAt);
  const boundary = frames.find((frame) => Math.abs(frame.time - start) < 1e-8);
  const resume = frames
    .filter((frame) => Math.abs(frame.time - end) < 1e-8)
    .at(-1);
  const before = frames.filter((frame) => frame.time < start - 1e-8);
  // At EOF the final visible pose precedes the clip endpoint. Keep both so
  // inserting/removing a tail hold does not change the original camera path.
  if (
    sampleAt < at - 1e-8 &&
    !before.some((frame) => Math.abs(frame.time - sampleAt - offset) < 1e-8)
  )
    before.push({
      time: sampleAt + offset,
      value,
      easing: "linear",
      recordingZoom: true,
    });
  return {
    animationOffset: offset,
    keyframes: [
      ...before,
      {
        ...boundary,
        time: start,
        value: duration === 0 && resume ? resume.value : value,
        easing: "linear",
        recordingZoom: true,
      },
      ...(duration > 0
        ? [
            {
              time: start + duration,
              value,
              easing: "linear" as const,
              recordingZoom: true as const,
            },
          ]
        : []),
      ...(duration > 0 && resume
        ? [{ ...resume, time: start + duration }]
        : []),
      ...frames
        .filter((frame) => frame.time > end + 1e-8)
        .map((frame) => ({
          ...frame,
          time: frame.time + duration - previousDuration,
        })),
    ],
  };
}

/** Edit the virtual source stream; no images or temporary media are generated. */
function extensionResult(
  project: Project,
  id: string,
  local: number,
  seconds: number,
  position: FrameExtensionPosition,
) {
  const error = frameExtensionTargetError(project, id);
  if (error) return { error };
  const clip = project.clips.find((clip) => clip.id === id)!;
  const target =
    position === "start" ? 0 : position === "end" ? clip.duration : local;
  if (
    !Number.isFinite(target) ||
    target < 0 ||
    target > clip.duration ||
    (target === clip.duration && position !== "end")
  )
    return { error: "请将播放头移到视频片段内" };
  const parts = mediaSegments(clip);
  const tail = parts.at(-1);
  const existing =
    position === "end"
      ? tail?.freeze
        ? frameExtensionAt(clip, tail.start)
        : undefined
      : frameExtensionAt(clip, target);
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
  const at =
    existing?.start ??
    (position === "end"
      ? clip.duration
      : Math.max(
          0,
          Math.min(
            clip.duration - 1 / project.canvas.fps,
            Math.max(
              0,
              Math.round(target * project.canvas.fps) / project.canvas.fps,
            ),
          ),
        ));
  const recording = recordingMaster(project, id);
  const members = recording
    ? project.clips.filter((member) => member.groupId === clip.groupId)
    : [clip];
  const memberIds = new Set(members.map((member) => member.id));
  const updates = new Map<string, Clip | null>();
  for (const member of members) {
    const memberAt = clip.start + at - member.start;
    if (memberAt < -1e-8) {
      updates.set(member.id, { ...member, start: member.start + delta });
      continue;
    }
    // A microphone can finish before the screen capture. Do not revive its tail.
    if (memberAt > member.duration + 1e-8) continue;
    const localAt = Math.max(0, Math.min(member.duration, memberAt));
    const previousDuration = Math.min(
      existing?.duration ?? 0,
      member.duration - localAt,
    );
    const source = project.assets.find((asset) => asset.id === member.assetId)!;
    let next =
      member.kind === "image" || member.loop
        ? { ...member, duration: member.duration + duration - previousDuration }
        : extendMedia(
            member,
            source.duration,
            localAt,
            previousDuration,
            duration,
            project.canvas.fps,
          );
    if (next && recording)
      next = {
        ...next,
        ...extendRecordingAnimation(
          member,
          localAt,
          previousDuration,
          duration,
          project.canvas.fps,
        ),
      };
    if (next && next.duration > 86400)
      return { error: "片段总时长不能超过 24 小时" };
    if (next && (next.stitch?.length ?? 0) > 10000)
      return { error: "片段分段数超出项目限制" };
    if (next && next.keyframes.length > 10000)
      return { error: "动画关键帧数超出项目限制" };
    updates.set(member.id, next && next.duration > 1e-8 ? next : null);
  }
  // Make room on every internal track and move following groups as a whole.
  const following = selectionWithGroups(
    project,
    project.clips
      .filter(
        (other) =>
          !memberIds.has(other.id) &&
          members.some(
            (member) =>
              updates.has(member.id) &&
              other.trackId === member.trackId &&
              other.start >= member.start + member.duration - 1e-8,
          ),
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
      updates.has(other.id)
        ? updates.get(other.id)
          ? [updates.get(other.id)!]
          : []
        : [
            shifted.has(other.id)
              ? { ...other, start: other.start + delta }
              : other,
          ],
    ),
  };
  // Collapsed recordings hide their internal tracks from normal layout checks.
  if (
    recording &&
    result.clips.some(
      (member) =>
        memberIds.has(member.id) &&
        result.clips.some(
          (other) =>
            !memberIds.has(other.id) &&
            other.trackId === member.trackId &&
            timelineRangesOverlap(member, other),
        ),
    )
  )
    return { error: "扩展后会与其他素材重叠，请先调整位置" };
  if (hasProjectTimelineOverlap(result))
    return { error: "扩展后会与其他素材重叠，请先调整位置" };
  return { project: result };
}

export function frameExtensionError(
  project: Project,
  id: string,
  local: number,
  seconds: number,
  position: FrameExtensionPosition = "playhead",
) {
  return extensionResult(project, id, local, seconds, position).error ?? null;
}

export function setFrameExtension(
  project: Project,
  id: string,
  local: number,
  seconds: number,
  position: FrameExtensionPosition = "playhead",
): Project {
  return (
    extensionResult(project, id, local, seconds, position).project ?? project
  );
}
