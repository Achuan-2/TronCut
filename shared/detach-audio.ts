import {
  defaultTransform,
  newTrack,
  uid,
  type Clip,
  type Project,
} from "./model";
import { editableIds } from "./timeline";

export function detachableVideos(project: Project, ids: readonly string[]) {
  const selected = new Set(ids);
  const editable = editableIds(project, ids);
  const audible = new Set(
    project.assets
      .filter((asset) => asset.hasAudio && !asset.missing)
      .map((asset) => asset.id),
  );
  return project.clips.filter(
    (clip) =>
      selected.has(clip.id) &&
      editable.has(clip.id) &&
      clip.kind === "video" &&
      !clip.audioDetached &&
      !!clip.assetId &&
      audible.has(clip.assetId),
  );
}

/** Reuse the source stream without re-encoding; audio and video stay independently editable. */
export function detachVideoAudio(
  project: Project,
  ids: readonly string[],
): Project {
  const videos = detachableVideos(project, ids);
  if (!videos.length) return project;
  const sourceTracks = new Set(videos.map((clip) => clip.trackId));
  if (project.tracks.length + sourceTracks.size > 128)
    throw new Error("轨道数量已达上限，请先移除空轨道");
  const audioTracks = new Map(
    [...sourceTracks].map((id) => {
      const source = project.tracks.find((track) => track.id === id)!;
      return [
        id,
        {
          ...newTrack(project.tracks.length),
          hidden: source.hidden,
          muted: source.muted,
          solo: source.solo,
        },
      ];
    }),
  );
  const selected = new Set(videos.map((clip) => clip.id));
  const audio: Clip[] = videos.map((clip) => ({
    id: uid(),
    name: `${clip.name}（音频）`,
    kind: "audio",
    assetId: clip.assetId,
    trackId: audioTracks.get(clip.trackId)!.id,
    start: clip.start,
    duration: clip.duration,
    sourceIn: clip.sourceIn,
    speed: clip.speed,
    speedEffect: clip.speedEffect,
    loop: clip.loop,
    stitch: clip.stitch,
    volume: clip.volume,
    podcast: clip.podcast,
    fadeIn: clip.fadeIn,
    fadeOut: clip.fadeOut,
    fadeTiming: clip.fadeTiming,
    transform: { ...defaultTransform },
    keyframes: [],
    groupId: clip.groupId,
    recordingRole: clip.recordingRole ? "microphone" : undefined,
  }));
  return {
    ...project,
    tracks: project.tracks.flatMap((track) =>
      audioTracks.has(track.id) ? [track, audioTracks.get(track.id)!] : [track],
    ),
    clips: [
      ...project.clips.map((clip) =>
        selected.has(clip.id) ? { ...clip, audioDetached: true } : clip,
      ),
      ...audio,
    ],
  };
}
