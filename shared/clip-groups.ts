import { type Clip, type Project, uid } from "./model";
import { recordingGroups, recordingTimeline } from "./recording-objects";

export type ClipGroup = NonNullable<Project["groups"]>[number];
type GroupDocument = Pick<Project, "clips" | "groups">;
export interface GroupScope {
  id: string;
  /** Document start; also the origin of legacy group-relative markers. */
  offset: number;
  end: number;
  trackIds: string[];
}

/** Old projects need no migration: a groupId alone still defines a group. */
export function groupName(project: GroupDocument, id: string): string {
  const named = project.groups?.find((group) => group.id === id);
  if (named) return named.name;
  const recording = recordingGroups(project).get(id);
  if (recording) return recording.name;
  const ids = [
    ...new Set(
      project.clips.flatMap((clip) => (clip.groupId ? [clip.groupId] : [])),
    ),
  ];
  return `组合 ${Math.max(1, ids.indexOf(id) + 1)}`;
}

export function rootGroupId(
  project: Pick<Project, "groups">,
  id?: string,
): string | undefined {
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const parent = project.groups?.find((group) => group.id === id)?.parentId;
    if (!parent || seen.has(parent)) return id;
    id = parent;
  }
  return id;
}

export function descendantGroupIds(
  project: Pick<Project, "groups">,
  id: string,
): Set<string> {
  const ids = new Set([id]);
  for (let size = 0; size !== ids.size;) {
    size = ids.size;
    for (const group of project.groups ?? [])
      if (group.parentId && ids.has(group.parentId)) ids.add(group.id);
  }
  return ids;
}

export function groupMembers(project: GroupDocument, id: string): Clip[] {
  const ids = descendantGroupIds(project, id);
  return project.clips.filter((clip) => clip.groupId && ids.has(clip.groupId));
}

export function renameClipGroup(
  project: Project,
  id: string,
  name: string,
): Project {
  name = name.trim().slice(0, 100);
  if (
    !name ||
    !groupMembers(project, id).length ||
    name === groupName(project, id)
  )
    return project;
  const groups = project.groups ?? [];
  return {
    ...project,
    groups: groups.some((group) => group.id === id)
      ? groups.map((group) => (group.id === id ? { ...group, name } : group))
      : [...groups, { id, name }],
  };
}

export function createClipGroup(
  project: Project,
  selected: Set<string>,
): Project {
  const id = uid();
  const roots = new Set(
    project.clips
      .filter((clip) => selected.has(clip.id))
      .flatMap((clip) => {
        const root = rootGroupId(project, clip.groupId);
        return root ? [root] : [];
      }),
  );
  const groups = [...(project.groups ?? [])];
  for (const root of roots)
    if (!groups.some((group) => group.id === root))
      groups.push({ id: root, name: groupName(project, root) });
  const names = new Set([
    ...groups.map((group) => group.name),
    ...project.clips.flatMap((clip) =>
      clip.groupId ? [groupName(project, clip.groupId)] : [],
    ),
  ]);
  let index = 1;
  while (names.has(`组合 ${index}`)) index++;
  return {
    ...project,
    groups: [
      ...groups.map((group) =>
        roots.has(group.id) ? { ...group, parentId: id } : group,
      ),
      { id, name: `组合 ${index}` },
    ],
    clips: project.clips.map((clip) =>
      selected.has(clip.id) && !clip.groupId ? { ...clip, groupId: id } : clip,
    ),
  };
}

export function ungroupClips(project: Project, selected: Set<string>): Project {
  const roots = new Set(
    project.clips
      .filter((clip) => selected.has(clip.id))
      .flatMap((clip) => {
        const root = rootGroupId(project, clip.groupId);
        return root ? [root] : [];
      }),
  );
  return {
    ...project,
    groups: project.groups
      ?.filter((group) => !roots.has(group.id))
      .map((group) =>
        group.parentId && roots.has(group.parentId)
          ? { ...group, parentId: undefined }
          : group,
      ),
    clips: project.clips.map((clip) =>
      clip.groupId && roots.has(clip.groupId)
        ? {
            ...clip,
            groupId: undefined,
            recording: undefined,
            recordingRole: undefined,
          }
        : clip,
    ),
  };
}

export function createGroupScope(
  project: Project,
  id: string,
): GroupScope | null {
  const members = groupMembers(project, id);
  if (!members.length) return null;
  return {
    id,
    offset: Math.min(...members.map((clip) => clip.start)),
    end: Math.max(...members.map((clip) => clip.start + clip.duration)),
    trackIds: [...new Set(members.map((clip) => clip.trackId))],
  };
}

/** Project only the active group. Removing its outer membership allows independent selection. */
export function projectForGroup(
  project: Project,
  scope: GroupScope | null,
): Project {
  if (!scope) return project;
  const ids = descendantGroupIds(project, scope.id);
  const clips = groupMembers(project, scope.id).map((clip) => ({
    ...clip,
    groupId: clip.groupId === scope.id ? undefined : clip.groupId,
  }));
  const tracks = new Set([
    ...scope.trackIds,
    ...clips.map((clip) => clip.trackId),
  ]);
  return {
    ...project,
    clips,
    tracks: project.tracks.filter((track) => tracks.has(track.id)),
    camera: undefined,
    markers: (
      project.groups?.find((group) => group.id === scope.id)?.markers ?? []
    ).map((marker) => ({ ...marker, time: marker.time + scope.offset })),
    groups: project.groups
      ?.filter((group) => group.id !== scope.id && ids.has(group.id))
      .map((group) =>
        group.parentId === scope.id ? { ...group, parentId: undefined } : group,
      ),
  };
}

/** Group edits keep document time; only the stored group markers use a local clock. */
export function mergeGroupProject(
  document: Project,
  scope: GroupScope,
  edited: Project,
): Project {
  const before = projectForGroup(document, scope);
  const members = new Set(before.clips.map((clip) => clip.id));
  const outside = document.clips.filter((clip) => !members.has(clip.id));
  const replacements = new Map(
    edited.clips.map((clip) => [
      clip.id,
      {
        ...clip,
        groupId: clip.groupId ?? scope.id,
      },
    ]),
  );
  const clips = document.clips.flatMap((clip) =>
    members.has(clip.id)
      ? replacements.has(clip.id)
        ? [replacements.get(clip.id)!]
        : []
      : [clip],
  );
  clips.push(
    ...[...replacements.values()].filter((clip) => !members.has(clip.id)),
  );
  const changedTracks = new Map(
    edited.tracks.map((track) => [track.id, track]),
  );
  const localTracks = new Set(before.tracks.map((track) => track.id));
  const occupiedOutside = new Set(outside.map((clip) => clip.trackId));
  // Preserve the local layer order, including newly inserted tracks. Tracks
  // outside the group retain their relative order and shared tracks survive.
  const pendingTracks = [...edited.tracks];
  const tracks: Project["tracks"] = [];
  let insertion = 0;
  for (const track of document.tracks) {
    if (
      localTracks.has(track.id) &&
      (changedTracks.has(track.id) || !occupiedOutside.has(track.id))
    ) {
      const next = pendingTracks.shift();
      if (next) tracks.push(next);
      insertion = tracks.length;
    } else tracks.push(track);
  }
  tracks.splice(insertion, 0, ...pendingTracks);
  const descendants = descendantGroupIds(document, scope.id);
  const own = document.groups?.find((group) => group.id === scope.id) ?? {
    id: scope.id,
    name: groupName(document, scope.id),
  };
  const origin = edited.clips.length
    ? Math.min(...edited.clips.map((clip) => clip.start))
    : scope.offset;
  const retainedAssets = document.assets.filter(
    (asset) =>
      outside.some((clip) => clip.assetId === asset.id) &&
      !edited.assets.some((entry) => entry.id === asset.id),
  );
  return {
    ...document,
    name: edited.name,
    canvas: edited.canvas,
    audio: edited.audio,
    assets: retainedAssets.length
      ? [...edited.assets, ...retainedAssets]
      : edited.assets,
    exportSettings: edited.exportSettings,
    clips,
    tracks,
    groups: [
      ...(document.groups ?? []).filter((group) => !descendants.has(group.id)),
      {
        ...own,
        markers: edited.markers.map((marker) => ({
          ...marker,
          time: Math.max(0, marker.time - origin),
        })),
      },
      ...(edited.groups ?? []).map((group) => ({
        ...group,
        parentId: group.parentId ?? scope.id,
      })),
    ],
  };
}

export function clampGroupTime(scope: GroupScope | null, time: number) {
  return scope ? Math.max(scope.offset, Math.min(scope.end, time)) : time;
}

export interface TimelineGroup {
  id: string;
  name: string;
  members: Clip[];
}

/** Collapse ordinary groups to one timeline entry while keeping render/export media flat. */
export function groupedTimeline(
  project: GroupDocument & Pick<Project, "tracks">,
) {
  const timeline = recordingTimeline(project);
  const recordings = recordingGroups(project);
  const groups = new Map<string, TimelineGroup>();
  const hidden = new Set(timeline.hidden);
  const proxies: Clip[] = [];
  const roots = new Set(
    project.clips.flatMap((clip) => {
      const root = rootGroupId(project, clip.groupId);
      return root && !recordings.has(root) ? [root] : [];
    }),
  );
  for (const id of roots) {
    const members = groupMembers(project, id);
    const first = [...members].sort(
      (a, b) =>
        project.tracks.findIndex((track) => track.id === a.trackId) -
          project.tracks.findIndex((track) => track.id === b.trackId) ||
        a.start - b.start,
    )[0];
    const start = Math.min(...members.map((clip) => clip.start));
    for (const clip of members) hidden.add(clip.id);
    groups.set(first.id, { id, name: groupName(project, id), members });
    proxies.push({
      ...first,
      groupId: id,
      start,
      duration:
        Math.max(...members.map((clip) => clip.start + clip.duration)) - start,
    });
  }
  const clips = [
    ...timeline.clips.filter((clip) => !hidden.has(clip.id)),
    ...proxies,
  ];
  for (const proxy of proxies) hidden.delete(proxy.id);
  const occupied = new Set(clips.map((clip) => clip.trackId));
  const visible = new Set(timeline.tracks.map((track) => track.id));
  const collapsed = new Set(
    [...groups.values()].flatMap((group) =>
      group.members.map((clip) => clip.trackId),
    ),
  );
  return {
    ...timeline,
    clips,
    hidden,
    groups,
    tracks: project.tracks.filter(
      (track) =>
        (visible.has(track.id) || occupied.has(track.id)) &&
        (!collapsed.has(track.id) || occupied.has(track.id)),
    ),
  };
}
