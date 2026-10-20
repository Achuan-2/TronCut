import type { Clip, Project } from "./model";
import { groupMembers, groupedTimeline, rootGroupId } from "./clip-groups";
import { editableIds, moveClipGroup, selectionWithGroups } from "./timeline";
import { exciseTimelineRange, type TimelineRange } from "./timeline-range";
import {
  hasProjectTimelineOverlap,
  timelineRangesOverlap,
} from "./timeline-collision";

/** Resolve all overwrites before committing the move, including grouped media. */
function overwritePlacement(
  before: Project,
  placed: Project,
  ids: Set<string>,
): Project {
  if (placed === before) return before;
  if (
    placed.tracks.length === before.tracks.length &&
    placed.clips.every((clip, index) => {
      const original = before.clips[index];
      return (
        clip.id === original?.id &&
        clip.start === original.start &&
        clip.trackId === original.trackId
      );
    })
  )
    return before;
  const moving = groupedTimeline(placed).clips.filter((clip) =>
    ids.has(clip.id),
  );
  const stationary = groupedTimeline(before).clips.filter(
    (clip) => !ids.has(clip.id),
  );
  const cuts = new Map<string, { members: Clip[]; ranges: TimelineRange[] }>();
  for (const target of stationary) {
    const ranges = moving
      .filter(
        (clip) =>
          clip.trackId === target.trackId &&
          timelineRangesOverlap(clip, target),
      )
      .map((clip) => ({ start: clip.start, end: clip.start + clip.duration }));
    if (!ranges.length) continue;
    const group = rootGroupId(before, target.groupId);
    const members = group ? groupMembers(before, group) : [target];
    // A locked group member must never leave a partially overwritten object.
    if (
      editableIds(
        before,
        members.map((clip) => clip.id),
      ).size !== members.length
    )
      return before;
    cuts.set(target.id, { members, ranges });
  }
  if (!cuts.size) return hasProjectTimelineOverlap(placed) ? before : placed;

  const replacements = new Map<string, Clip[]>();
  const removed = new Set<string>();
  const groups = [...(placed.groups ?? [])];
  const groupIds = new Set(groups.map((group) => group.id));
  for (const { members, ranges } of cuts.values()) {
    let remainder: Project = { ...before, clips: members };
    for (const range of ranges.sort((a, b) => a.start - b.start))
      remainder = exciseTimelineRange(remainder, range);
    replacements.set(members[0].id, remainder.clips);
    members.forEach((clip) => removed.add(clip.id));
    for (const group of remainder.groups ?? [])
      if (!groupIds.has(group.id)) {
        groupIds.add(group.id);
        groups.push(group);
      }
  }
  const result = {
    ...placed,
    ...(groups.length ? { groups } : {}),
    clips: placed.clips.flatMap(
      (clip) =>
        replacements.get(clip.id) ?? (removed.has(clip.id) ? [] : [clip]),
    ),
  };
  return hasProjectTimelineOverlap(result) ? before : result;
}

/** Dragging replaces occupied time; content outside the destination stays in place. */
export function moveTimelineClips(
  project: Project,
  ids: readonly string[],
  wanted: number,
  targetTrackId?: string,
): Project {
  if (!Number.isFinite(wanted)) return project;
  const requested = selectionWithGroups(project, ids);
  const selected = editableIds(project, requested);
  if (!selected.size || selected.size !== requested.length) return project;
  const members = project.clips.filter((clip) => selected.has(clip.id));
  const delta = Math.max(
    -Math.min(...members.map((clip) => clip.start)),
    wanted,
  );
  const target =
    selected.size === 1 && targetTrackId
      ? project.tracks.find((track) => track.id === targetTrackId)
      : undefined;
  if (
    selected.size === 1 &&
    targetTrackId &&
    (!target ||
      target.locked ||
      Boolean(target.captionTrack) !== Boolean(members[0].caption))
  )
    return project;
  if (!delta && (!target || target.id === members[0].trackId)) return project;
  const placed = {
    ...project,
    clips: project.clips.map((clip) =>
      selected.has(clip.id)
        ? {
            ...clip,
            start: clip.start + delta,
            trackId: target?.id ?? clip.trackId,
          }
        : clip,
    ),
  };
  return overwritePlacement(project, placed, selected);
}

export function moveTimelineGroup(
  project: Project,
  id: string,
  delta: number,
  trackId: string,
): Project {
  const placed = moveClipGroup(project, id, delta, trackId, {
    allowOverlap: true,
  });
  return overwritePlacement(
    project,
    placed,
    new Set(groupMembers(project, id).map((clip) => clip.id)),
  );
}
