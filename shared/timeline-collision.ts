import { type Clip, type Project, newTrack, numberTracks } from "./model";
import {
  createClipGroup,
  createGroupScope,
  groupMembers,
  groupedTimeline,
  projectForGroup,
  rootGroupId,
} from "./clip-groups";

type TimelineProject = Pick<Project, "clips" | "tracks" | "groups">;
const epsilon = 1e-7;

/** Visual-property edits must not pay for collision checks on every pointer move. */
export function timelineLayoutChanged(
  before: Project,
  after: Project,
): boolean {
  if (
    before.clips.length !== after.clips.length ||
    before.tracks.length !== after.tracks.length
  )
    return true;
  if (before.tracks.some((track, index) => track.id !== after.tracks[index].id))
    return true;
  if (
    before.clips !== after.clips &&
    before.clips.some((clip, index) => {
      const next = after.clips[index];
      return (
        clip.id !== next.id ||
        clip.start !== next.start ||
        clip.duration !== next.duration ||
        clip.trackId !== next.trackId ||
        clip.groupId !== next.groupId
      );
    })
  )
    return true;
  const groups = before.groups ?? [];
  const nextGroups = after.groups ?? [];
  return (
    groups.length !== nextGroups.length ||
    groups.some(
      (group, index) =>
        group.id !== nextGroups[index].id ||
        group.parentId !== nextGroups[index].parentId,
    )
  );
}

/** Touching endpoints are valid cuts, including floating-point frame times. */
export function timelineRangesOverlap(
  a: Pick<Clip, "start" | "duration">,
  b: Pick<Clip, "start" | "duration">,
) {
  return (
    a.start < b.start + b.duration - epsilon &&
    b.start < a.start + a.duration - epsilon
  );
}

function overlapComponents(clips: Clip[]): Clip[][] {
  const tracks = new Map<string, Clip[]>();
  for (const clip of clips) {
    const entries = tracks.get(clip.trackId) ?? [];
    entries.push(clip);
    tracks.set(clip.trackId, entries);
  }
  const components: Clip[][] = [];
  for (const entries of tracks.values()) {
    entries.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
    let component: Clip[] = [];
    let end = -Infinity;
    for (const clip of entries) {
      if (clip.start >= end - epsilon) {
        if (component.length > 1) components.push(component);
        component = [];
      }
      component.push(clip);
      end = Math.max(
        component.length === 1 ? -Infinity : end,
        clip.start + clip.duration,
      );
    }
    if (component.length > 1) components.push(component);
  }
  return components;
}

export function hasTimelineOverlap(project: TimelineProject): boolean {
  return overlapComponents(groupedTimeline(project).clips).length > 0;
}

export function hasProjectTimelineOverlap(project: Project): boolean {
  if (hasTimelineOverlap(project)) return true;
  const ids = new Set([
    ...(project.groups ?? []).map((group) => group.id),
    ...project.clips.flatMap((clip) => (clip.groupId ? [clip.groupId] : [])),
  ]);
  for (const id of ids) {
    const scope = createGroupScope(project, id);
    if (scope && hasTimelineOverlap(projectForGroup(project, scope)))
      return true;
  }
  return false;
}

export function timelineTrackIsFree(
  project: TimelineProject,
  trackId: string,
  start: number,
  duration: number,
): boolean {
  return !groupedTimeline(project).clips.some(
    (clip) =>
      clip.trackId === trackId &&
      timelineRangesOverlap(clip, { start, duration }),
  );
}

/** Resolve one shared delta for a selection, so snapping never separates members. */
export function constrainTimelineMove(
  project: TimelineProject,
  ids: readonly string[],
  wanted: number,
  targetTrackId?: string,
): number {
  if (!Number.isFinite(wanted)) return 0;
  const selected = new Set(ids);
  const timeline = groupedTimeline(project);
  const moving = timeline.clips.filter((clip) => selected.has(clip.id));
  if (!moving.length) return 0;
  const members = project.clips.filter((clip) => selected.has(clip.id));
  const minimum = -Math.min(...members.map((clip) => clip.start));
  const delta = Math.max(minimum, wanted);
  const blocked: { start: number; end: number }[] = [];
  for (const clip of moving) {
    const trackId =
      moving.length === 1 && targetTrackId ? targetTrackId : clip.trackId;
    for (const other of timeline.clips) {
      if (selected.has(other.id) || other.trackId !== trackId) continue;
      blocked.push({
        start: other.start - clip.start - clip.duration,
        end: other.start + other.duration - clip.start,
      });
    }
  }
  blocked.sort((a, b) => a.start - b.start);
  const union: typeof blocked = [];
  for (const range of blocked) {
    const last = union.at(-1);
    // Two open intervals sharing one boundary leave an exact-fit placement there.
    if (last && range.start < last.end - epsilon)
      last.end = Math.max(last.end, range.end);
    else union.push({ ...range });
  }
  const hit = union.find(
    (range) => delta > range.start + epsilon && delta < range.end - epsilon,
  );
  if (!hit) return delta;
  if (hit.start < minimum - epsilon) return hit.end;
  return Math.abs(delta - hit.start) <= Math.abs(hit.end - delta)
    ? hit.start
    : hit.end;
}

export function timelineTrimBounds(
  project: TimelineProject,
  id: string,
): { start: number; end: number } {
  const clips = groupedTimeline(project).clips;
  const clip = clips.find((entry) => entry.id === id);
  if (!clip) return { start: 0, end: Infinity };
  let start = 0;
  let end = Infinity;
  for (const other of clips) {
    if (other.id === id || other.trackId !== clip.trackId) continue;
    if (other.start + other.duration <= clip.start + epsilon)
      start = Math.max(start, other.start + other.duration);
    if (other.start >= clip.start + clip.duration - epsilon)
      end = Math.min(end, other.start);
  }
  return { start, end };
}

/** Keep old layer order: later clips on one track were composited on top. */
function separateGroupTracks(project: Project, id: string): Project {
  const selected = new Set(groupMembers(project, id).map((clip) => clip.id));
  const replacements = new Map<string, string>();
  const tracks: Project["tracks"] = [];
  let created = 0;
  for (const track of project.tracks) {
    tracks.push(track);
    const members = project.clips
      .filter((clip) => selected.has(clip.id) && clip.trackId === track.id)
      .reverse();
    for (const clip of members.slice(1)) {
      if (project.tracks.length + created >= 128)
        throw new Error(
          "重叠素材分轨需要超过 128 条轨道，请先减少工程轨道数量",
        );
      created++;
      const added = { ...track, id: newTrack(tracks.length).id };
      tracks.push(added);
      replacements.set(clip.id, added.id);
    }
  }
  if (!replacements.size) return project;
  return {
    ...project,
    tracks: numberTracks(tracks),
    clips: project.clips.map((clip) =>
      replacements.has(clip.id)
        ? { ...clip, trackId: replacements.get(clip.id)! }
        : clip,
    ),
  };
}

/** One-time load migration; never move media in time or discard an overlapping clip. */
export function groupExistingTimelineOverlaps(project: Project): Project {
  let next = project;
  const ids = new Set([
    ...(project.groups ?? []).map((group) => group.id),
    ...project.clips.flatMap((clip) => (clip.groupId ? [clip.groupId] : [])),
  ]);
  for (const id of ids) {
    const scope = createGroupScope(next, id);
    if (scope && hasTimelineOverlap(projectForGroup(next, scope)))
      next = separateGroupTracks(next, id);
  }
  // Each pass merges at least two visible entries; changed group bounds can
  // expose another collision on an anchor track, so continue until stable.
  for (;;) {
    const components = overlapComponents(groupedTimeline(next).clips);
    if (!components.length) return next;
    for (const component of components) {
      const selected = new Set(
        component.flatMap((clip) => {
          const root = rootGroupId(next, clip.groupId);
          return root
            ? groupMembers(next, root).map((member) => member.id)
            : [clip.id];
        }),
      );
      const grouped = createClipGroup(next, selected);
      next = separateGroupTracks(grouped, grouped.groups!.at(-1)!.id);
    }
  }
}
