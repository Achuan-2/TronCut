import { type Clip, type Project, newText, newTrack } from "./model";
import type { Cue } from "./subtitles";

export function captionClips(project: Project) {
  return project.clips
    .filter((clip) => clip.caption)
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}

export function ensureCaptionTrack(project: Project): {
  project: Project;
  trackId: string;
} {
  const dedicated = project.tracks.find((track) => track.captionTrack);
  if (dedicated)
    return {
      project: {
        ...project,
        tracks: project.tracks.map((track) =>
          track.id === dedicated.id
            ? track
            : track.captionTrack
              ? { ...track, captionTrack: undefined }
              : track,
        ),
        clips: project.clips.map((clip) =>
          clip.caption && clip.trackId !== dedicated.id
            ? { ...clip, trackId: dedicated.id }
            : clip,
        ),
      },
      trackId: dedicated.id,
    };

  const captions = captionClips(project);
  const reusable = project.tracks.find((track) => {
    const clips = project.clips.filter((clip) => clip.trackId === track.id);
    return clips.length > 0 && clips.every((clip) => clip.caption);
  });
  if (reusable)
    return {
      project: {
        ...project,
        tracks: project.tracks.map((track) =>
          track.id === reusable.id ? { ...track, captionTrack: true } : track,
        ),
      },
      trackId: reusable.id,
    };

  const track = { ...newTrack(project.tracks.length), captionTrack: true };
  return {
    project: {
      ...project,
      tracks: [track, ...project.tracks],
      clips: captions.length
        ? project.clips.map((clip) =>
            clip.caption ? { ...clip, trackId: track.id } : clip,
          )
        : project.clips,
    },
    trackId: track.id,
  };
}

export function appendCaptionCues(
  input: Project,
  cues: Cue[],
): { project: Project; ids: string[] } {
  if (!cues.length) return { project: input, ids: [] };
  const ensured = ensureCaptionTrack(input);
  const track = ensured.project.tracks.find(
    (item) => item.id === ensured.trackId,
  )!;
  if (track.locked) throw new Error("字幕轨道已锁定，请先解锁");
  const clips = cues.flatMap((cue) => {
    if (!cue.text.trim() || cue.end <= cue.start) return [];
    const clip = newText(track.id, cue.start, 0, cue.text);
    clip.duration = cue.end - cue.start;
    clip.caption = true;
    clip.transform.y = 0.85;
    clip.style!.fontSize = 56;
    return [clip];
  });
  return {
    project: {
      ...ensured.project,
      clips: [...ensured.project.clips, ...clips],
    },
    ids: clips.map((clip) => clip.id),
  };
}

export function replaceCaptionText(
  project: Project,
  search: string,
  replacement: string,
): { project: Project; changed: number } {
  if (!search) return { project, changed: 0 };
  const locked = new Set(
    project.tracks.filter((track) => track.locked).map((track) => track.id),
  );
  let changed = 0;
  const clips = project.clips.map((clip) => {
    if (
      !clip.caption ||
      locked.has(clip.trackId) ||
      !clip.text?.includes(search)
    )
      return clip;
    const text = clip.text.split(search).join(replacement);
    changed += 1;
    return { ...clip, text, name: text.slice(0, 24) || "空白字幕" };
  });
  return changed
    ? { project: { ...project, clips }, changed }
    : { project, changed };
}

export function convertCaptionsToText(
  project: Project,
  ids: readonly string[],
): { project: Project; ids: string[] } {
  const wanted = new Set(ids);
  const locked = new Set(
    project.tracks.filter((track) => track.locked).map((track) => track.id),
  );
  const converted = project.clips.filter(
    (clip) => clip.caption && wanted.has(clip.id) && !locked.has(clip.trackId),
  );
  if (!converted.length) return { project, ids: [] };

  const convertedIds = new Set(converted.map((clip) => clip.id));
  const sourceTracks = new Set(converted.map((clip) => clip.trackId));
  const needsTextTrack = [...sourceTracks].some((trackId) =>
    project.clips.some(
      (clip) =>
        clip.trackId === trackId && clip.caption && !convertedIds.has(clip.id),
    ),
  );
  const textTrack = needsTextTrack ? newTrack(project.tracks.length) : null;
  const clips = project.clips.map((clip) =>
    convertedIds.has(clip.id)
      ? {
          ...clip,
          trackId: textTrack?.id ?? clip.trackId,
          caption: false,
          name: clip.text?.slice(0, 24) || "文本",
        }
      : clip,
  );
  const remainingCaptionTracks = new Set(
    clips.filter((clip) => clip.caption).map((clip) => clip.trackId),
  );
  const tracks = project.tracks.map((track) =>
    track.captionTrack && !remainingCaptionTracks.has(track.id)
      ? { ...track, captionTrack: undefined }
      : track,
  );
  return {
    project: {
      ...project,
      tracks: textTrack ? [textTrack, ...tracks] : tracks,
      clips,
    },
    ids: converted.map((clip) => clip.id),
  };
}

export function previousCaption(
  project: Project,
  id: string,
): Clip | undefined {
  const captions = captionClips(project);
  const index = captions.findIndex((clip) => clip.id === id);
  return index > 0 ? captions[index - 1] : undefined;
}

export function mergeWithPreviousCaption(
  project: Project,
  id: string,
): { project: Project; selectedId?: string } {
  const current = project.clips.find((clip) => clip.id === id && clip.caption);
  const previous = previousCaption(project, id);
  if (!current || !previous || current.trackId !== previous.trackId)
    return { project };
  if (project.tracks.find((track) => track.id === current.trackId)?.locked)
    return { project };
  const end = Math.max(
    previous.start + previous.duration,
    current.start + current.duration,
  );
  const text = [previous.text, current.text].filter(Boolean).join("\n");
  return {
    project: {
      ...project,
      clips: project.clips
        .filter((clip) => clip.id !== current.id)
        .map((clip) =>
          clip.id === previous.id
            ? {
                ...clip,
                duration: end - previous.start,
                text,
                name: text.slice(0, 24) || "空白字幕",
              }
            : clip,
        ),
    },
    selectedId: previous.id,
  };
}
