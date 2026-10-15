import { type Clip, type Project, uid } from "./model";
import { splitClip } from "./editor";

export function editableIds(
  project: Project,
  ids: readonly string[],
): Set<string> {
  const locked = new Set(
    project.tracks.filter((t) => t.locked).map((t) => t.id),
  );
  return new Set(
    project.clips
      .filter((c) => ids.includes(c.id) && !locked.has(c.trackId))
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
      .map((c) => c.groupId),
  );
  return project.clips
    .filter((c) => ids.includes(c.id) || (c.groupId && groups.has(c.groupId)))
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
  const offset = Math.max(-Math.min(...clips.map((c) => c.start)), delta);
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

/** Ripple only closes deleted time which no surviving clip occupies. Never trims other media. */
export function deleteClips(
  project: Project,
  ids: readonly string[],
  ripple = false,
): Project {
  const selected = editableIds(project, ids);
  if (!selected.size) return project;
  const remaining = project.clips.filter((c) => !selected.has(c.id));
  if (!ripple) return { ...project, clips: remaining };
  const occupied = union(
    remaining.map((c) => ({ start: c.start, end: c.start + c.duration })),
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
  const locked = new Set(
    project.tracks.filter((t) => t.locked).map((t) => t.id),
  );
  return {
    ...project,
    clips: remaining.map((c) =>
      locked.has(c.trackId) ? c : { ...c, start: shift(c.start) },
    ),
    markers: project.markers.map((m) => ({ ...m, time: shift(m.time) })),
  };
}

export function splitSelection(
  project: Project,
  ids: readonly string[],
  time: number,
): Project {
  return ids.reduce((p, id) => splitClip(p, id, time), project);
}

export function groupSelection(
  project: Project,
  ids: readonly string[],
  ungroup = false,
): Project {
  const selected = editableIds(project, ids);
  if (!selected.size || (!ungroup && selected.size < 2)) return project;
  const groupId = ungroup ? undefined : uid();
  return {
    ...project,
    clips: project.clips.map((c) =>
      selected.has(c.id) ? { ...c, groupId } : c,
    ),
  };
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
  return {
    project: { ...project, clips: [...project.clips, ...clips] },
    ids: clips.map((c) => c.id),
  };
}
