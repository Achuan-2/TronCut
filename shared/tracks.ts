import { type Project, newTrack, numberTracks } from "./model";
import { recordingGroups } from "./recording-objects";

function recordingTracks(project: Project, id: string) {
  const groups = new Set(
    [...recordingGroups(project).values()]
      .filter((clip) => clip.trackId === id)
      .map((clip) => clip.groupId),
  );
  return new Set([
    id,
    ...project.clips
      .filter((clip) => clip.groupId && groups.has(clip.groupId))
      .map((clip) => clip.trackId),
  ]);
}

export type Track = Project["tracks"][number];

export const defaultTrackHeight = 70;
export const minTrackHeight = 56;
export const maxTrackHeight = 360;

export function setTrackHeight(
  project: Project,
  id: string,
  height: number,
): Project {
  if (!Number.isFinite(height)) return project;
  const next = Math.max(
    minTrackHeight,
    Math.min(maxTrackHeight, Math.round(height)),
  );
  const track = project.tracks.find((track) => track.id === id);
  if (!track || (track.height ?? defaultTrackHeight) === next) return project;
  return {
    ...project,
    tracks: project.tracks.map((track) =>
      track.id === id ? { ...track, height: next } : track,
    ),
  };
}

export function isTrackActive(tracks: Track[], id: string): boolean {
  const track = tracks.find((item) => item.id === id);
  return (
    !!track &&
    !track.hidden &&
    (!tracks.some((item) => item.solo) || !!track.solo)
  );
}

export function displayTrackName(tracks: Track[], id: string): string {
  const track = tracks.find((item) => item.id === id);
  if (!track) return "";
  if (track.customName || !track.captionTrack) return track.name;
  const captions = tracks.filter((item) => item.captionTrack);
  return captions.length === 1
    ? "字幕"
    : `字幕 ${captions.length - captions.findIndex((item) => item.id === id)}`;
}

export function insertTrack(
  project: Project,
  anchorId: string,
  side: "above" | "below",
): Project {
  const index = project.tracks.findIndex((track) => track.id === anchorId);
  if (index < 0 || project.tracks.length >= 128) return project;
  const tracks = [...project.tracks];
  tracks.splice(index + Number(side === "below"), 0, newTrack(tracks.length));
  return { ...project, tracks: numberTracks(tracks) };
}

export function moveTrack(
  project: Project,
  id: string,
  direction: "up" | "down" | "top" | "bottom",
): Project {
  const index = project.tracks.findIndex((track) => track.id === id);
  if (index < 0) return project;
  const destination =
    direction === "top"
      ? 0
      : direction === "bottom"
        ? project.tracks.length - 1
        : Math.max(
            0,
            Math.min(
              project.tracks.length - 1,
              index + (direction === "up" ? -1 : 1),
            ),
          );
  if (destination === index) return project;
  const tracks = [...project.tracks];
  const [track] = tracks.splice(index, 1);
  tracks.splice(destination, 0, track);
  return { ...project, tracks: numberTracks(tracks) };
}

export function removeTrack(project: Project, id: string): Project {
  if (
    project.tracks.length <= 1 ||
    !project.tracks.some((track) => track.id === id && !track.locked)
  )
    return project;
  const owned = recordingTracks(project, id);
  if (project.tracks.some((track) => owned.has(track.id) && track.locked))
    return project;
  const groups = new Set(
    [...recordingGroups(project).values()]
      .filter((clip) => clip.trackId === id)
      .map((clip) => clip.groupId),
  );
  const clips = project.clips.filter(
    (clip) =>
      clip.trackId !== id && (!clip.groupId || !groups.has(clip.groupId)),
  );
  const occupied = new Set(clips.map((clip) => clip.trackId));
  return {
    ...project,
    tracks: numberTracks(
      project.tracks.filter(
        (track) =>
          track.id !== id && (!owned.has(track.id) || occupied.has(track.id)),
      ),
    ),
    clips,
  };
}

export function removeEmptyTracks(project: Project): Project {
  const occupied = new Set(project.clips.map((clip) => clip.trackId));
  const keep = project.tracks.filter(
    (track) => track.locked || occupied.has(track.id),
  );
  const tracks = keep.length ? keep : project.tracks.slice(0, 1);
  return tracks.length === project.tracks.length
    ? project
    : { ...project, tracks: numberTracks(tracks) };
}

export function renameTrack(
  project: Project,
  id: string,
  name: string,
): Project {
  const value = name.trim().slice(0, 100);
  const track = project.tracks.find((track) => track.id === id);
  if (!track || !value || (track.customName && track.name === value))
    return project;
  return {
    ...project,
    tracks: project.tracks.map((track) =>
      track.id === id ? { ...track, name: value, customName: true } : track,
    ),
  };
}

export function toggleTrack(
  project: Project,
  id: string,
  key: "hidden" | "solo" | "locked" | "muted",
): Project {
  if (!project.tracks.some((track) => track.id === id)) return project;
  const owned = recordingTracks(project, id);
  const value = !project.tracks.find((track) => track.id === id)![key];
  return {
    ...project,
    tracks: project.tracks.map((track) =>
      owned.has(track.id) ? { ...track, [key]: value } : track,
    ),
  };
}
