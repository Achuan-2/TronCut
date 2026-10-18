import { type Clip, type Project, uid } from "./model";
import { splitClip } from "./editor";
import { markerEnd } from "./markers";
import { recordingGroups, releasedRecordingTracks } from "./recording-objects";
import { isTrackActive } from "./tracks";
import {
  createClipGroup,
  descendantGroupIds,
  groupMembers,
  groupName,
  rootGroupId,
  ungroupClips,
} from "./clip-groups";
import { constrainTimelineMove } from "./timeline-collision";

export function editableIds(
  project: Project,
  ids: readonly string[],
): Set<string> {
  const locked = new Set(
    project.tracks.filter((t) => t.locked).map((t) => t.id),
  );
  const objects = recordingGroups(project);
  const blocked = new Set(
    project.clips
      .filter((clip) => clip.groupId && locked.has(clip.trackId))
      .map((clip) => rootGroupId(project, clip.groupId)),
  );
  const recordingIds = new Set(
    project.clips
      .filter(
        (clip) =>
          ids.includes(clip.id) && clip.groupId && objects.has(clip.groupId),
      )
      .map((clip) => clip.groupId),
  );
  return new Set(
    project.clips
      .filter(
        (c) =>
          (ids.includes(c.id) || (c.groupId && recordingIds.has(c.groupId))) &&
          !locked.has(c.trackId) &&
          (!c.groupId || !blocked.has(rootGroupId(project, c.groupId))),
      )
      .map((c) => c.id),
  );
}

export function selectionWithGroups(
  project: Project,
  ids: readonly string[],
): string[] {
  const groups = new Set(
    project.clips
      .filter((c) => ids.includes(c.id) && c.groupId)
      .map((c) => rootGroupId(project, c.groupId)),
  );
  return project.clips
    .filter(
      (c) =>
        ids.includes(c.id) ||
        (c.groupId && groups.has(rootGroupId(project, c.groupId))),
    )
    .map((c) => c.id);
}

/** Return editable clips intersecting a time range on the requested tracks. */
export function clipsInTimelineRange(
  project: Project,
  start: number,
  end: number,
  trackIds: readonly string[],
): string[] {
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  const tracks = new Set(trackIds);
  const lockedOrHidden = new Set(
    project.tracks
      .filter((track) => track.locked || track.hidden)
      .map((track) => track.id),
  );
  return project.clips
    .filter(
      (clip) =>
        tracks.has(clip.trackId) &&
        !lockedOrHidden.has(clip.trackId) &&
        clip.start <= to &&
        clip.start + clip.duration >= from,
    )
    .map((clip) => clip.id);
}

/** Move every selected unlocked clip by the same delta, preserving synchronization. */
export function moveClips(
  project: Project,
  ids: readonly string[],
  delta: number,
): Project {
  const selected = editableIds(project, ids);
  const clips = project.clips.filter((c) => selected.has(c.id));
  if (!clips.length || !Number.isFinite(delta)) return project;
  const offset = constrainTimelineMove(project, [...selected], delta);
  if (!offset) return project;
  return {
    ...project,
    clips: project.clips.map((c) =>
      selected.has(c.id) ? { ...c, start: c.start + offset } : c,
    ),
  };
}

type Range = { start: number; end: number };
function union(ranges: Range[]): Range[] {
  const result: Range[] = [];
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    const last = result.at(-1);
    if (last && range.start <= last.end)
      last.end = Math.max(last.end, range.end);
    else result.push({ ...range });
  }
  return result;
}

/** Close deleted time on selected tracks without trimming surviving media on those tracks. */
export function deleteClips(
  project: Project,
  ids: readonly string[],
  ripple = false,
): Project {
  const selected = editableIds(project, ids);
  if (!selected.size) return project;
  const remaining = project.clips.filter((c) => !selected.has(c.id));
  if (!ripple) return { ...project, clips: remaining };
  const affectedTracks = new Set(
    project.clips.filter((c) => selected.has(c.id)).map((c) => c.trackId),
  );
  const occupied = union(
    remaining
      .filter((c) => affectedTracks.has(c.trackId))
      .map((c) => ({ start: c.start, end: c.start + c.duration })),
  );
  let gaps = union(
    project.clips
      .filter((c) => selected.has(c.id))
      .map((c) => ({ start: c.start, end: c.start + c.duration })),
  );
  for (const range of occupied) {
    gaps = gaps.flatMap((g) => {
      if (range.end <= g.start || range.start >= g.end) return [g];
      const parts: Range[] = [];
      if (range.start > g.start)
        parts.push({ start: g.start, end: range.start });
      if (range.end < g.end) parts.push({ start: range.end, end: g.end });
      return parts;
    });
  }
  const shift = (time: number) =>
    time -
    gaps.reduce(
      (sum, g) => sum + Math.max(0, Math.min(time, g.end) - g.start),
      0,
    );
  return {
    ...project,
    clips: remaining.map((c) =>
      affectedTracks.has(c.trackId) ? { ...c, start: shift(c.start) } : c,
    ),
    markers: project.markers.map((marker) => ({
      ...marker,
      time: shift(marker.time),
      ...(marker.duration === undefined
        ? {}
        : {
            duration: shift(markerEnd(marker)) - shift(marker.time),
          }),
    })),
  };
}

export function splitSelection(
  project: Project,
  ids: readonly string[],
  time: number,
): Project {
  const selected = editableIds(project, selectionWithGroups(project, ids));
  const groups = new Set(
    project.clips
      .filter((clip) => selected.has(clip.id) && clip.groupId)
      .map((clip) => rootGroupId(project, clip.groupId)!),
  );
  const next = [...selected].reduce((p, id) => splitClip(p, id, time), project);
  const rightGroups = new Map<string, string>();
  for (const id of groups) {
    const members = groupMembers(project, id);
    if (
      !members.some((clip) => clip.start < time) ||
      !members.some((clip) => clip.start + clip.duration > time)
    )
      continue;
    for (const groupId of descendantGroupIds(project, id))
      rightGroups.set(groupId, uid());
  }
  return {
    ...next,
    ...(rightGroups.size
      ? {
          groups: [
            ...(next.groups ?? []),
            ...[...rightGroups].map(([id, copyId]) => {
              const group = project.groups?.find((entry) => entry.id === id);
              return {
                ...group,
                id: copyId,
                name: groupName(project, id),
                parentId: group?.parentId
                  ? rightGroups.get(group.parentId)
                  : undefined,
              };
            }),
          ],
        }
      : {}),
    clips: next.clips.map((clip) =>
      clip.groupId && rightGroups.has(clip.groupId) && clip.start >= time
        ? { ...clip, groupId: rightGroups.get(clip.groupId) }
        : clip,
    ),
  };
}

export function groupSelection(
  project: Project,
  ids: readonly string[],
  ungroup = false,
): Project {
  const selected = editableIds(project, selectionWithGroups(project, ids));
  if (!selected.size || (!ungroup && selected.size < 2)) return project;
  // A locked member must not leave a partially regrouped object behind.
  if (
    selectionWithGroups(project, [...selected]).some((id) => !selected.has(id))
  )
    return project;
  return ungroup
    ? {
        ...ungroupClips(project, selected),
        tracks: releasedRecordingTracks(project, selected),
      }
    : createClipGroup(project, selected);
}

export function pasteClips(
  project: Project,
  copied: Clip[],
  time: number,
): { project: Project; ids: string[] } {
  const valid = copied.filter(
    (c) =>
      project.tracks.some((t) => t.id === c.trackId && !t.locked) &&
      (!c.assetId || project.assets.some((a) => a.id === c.assetId)),
  );
  if (!valid.length) return { project, ids: [] };
  const origin = Math.min(...valid.map((c) => c.start));
  const groups = new Map<string, string>();
  const clips = valid.map((c) => {
    if (c.groupId && !groups.has(c.groupId)) groups.set(c.groupId, uid());
    return {
      ...structuredClone(c),
      id: uid(),
      start: Math.max(0, time) + c.start - origin,
      groupId: c.groupId ? groups.get(c.groupId) : undefined,
    };
  });
  // Copy names and nested membership along with the media, using fresh IDs.
  for (const clip of valid) {
    let id = clip.groupId;
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      seen.add(id);
      if (!groups.has(id)) groups.set(id, uid());
      id = project.groups?.find((group) => group.id === id)?.parentId;
    }
  }
  const copiedGroups = [...groups].map(([id, nextId]) => {
    const group = project.groups?.find((group) => group.id === id);
    return {
      ...group,
      id: nextId,
      name: group?.name ?? "组合",
      parentId: group?.parentId ? groups.get(group.parentId) : undefined,
    };
  });
  const pasted = {
    ...project,
    clips: [...project.clips, ...clips],
    ...(copiedGroups.length
      ? { groups: [...(project.groups ?? []), ...copiedGroups] }
      : {}),
  };
  const ids: string[] = clips.map((clip) => clip.id);
  const delta = constrainTimelineMove(pasted, ids, 0);
  return {
    project: delta
      ? {
          ...pasted,
          clips: pasted.clips.map((clip) =>
            ids.includes(clip.id)
              ? { ...clip, start: clip.start + delta }
              : clip,
          ),
        }
      : pasted,
    ids,
  };
}

/**
 * Find the primary clip located at the given playhead position.
 * Respects track visibility, lock status, solo state, and top-to-bottom visual track priority.
 */
export function findClipAtPlayhead(
  project: Project,
  playhead: number,
): Clip | undefined {
  for (const track of project.tracks) {
    if (track.locked || !isTrackActive(project.tracks, track.id)) continue;
    const match = project.clips.find(
      (clip) =>
        clip.trackId === track.id &&
        clip.start <= playhead &&
        playhead < clip.start + clip.duration,
    );
    if (match) return match;
  }
  for (const track of project.tracks) {
    if (track.locked || !isTrackActive(project.tracks, track.id)) continue;
    const match = project.clips.find(
      (clip) =>
        clip.trackId === track.id &&
        clip.start < playhead &&
        Math.abs(playhead - (clip.start + clip.duration)) < 1e-4,
    );
    if (match) return match;
  }
  return undefined;
}
