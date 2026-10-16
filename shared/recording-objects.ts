import {
  defaultTransform,
  newTrack,
  uid,
  type Asset,
  type Clip,
  type Project,
} from "./model";
import {
  recordingCameraFrames,
  sceneRecordingFrames,
} from "./recording-camera";
import type { RecordingSettings } from "./recording-settings";

/** Recording objects keep ordinary editable media underneath one timeline entry. */
export function recordingGroups(project: Pick<Project, "clips">) {
  const members = new Map<string, Clip[]>();
  for (const clip of project.clips) {
    if (!clip.groupId) continue;
    const group = members.get(clip.groupId) ?? [];
    group.push(clip);
    members.set(clip.groupId, group);
  }
  const groups = new Map<string, Clip>();
  for (const [id, clips] of members) {
    const masters = clips.filter(
      (clip) => clip.recording && clip.recordingRole === "screen",
    );
    if (masters.length === 1 && clips.every((clip) => clip.recordingRole))
      groups.set(id, masters[0]);
  }
  return groups;
}

export function recordingMaster(
  project: Pick<Project, "clips">,
  clipId: string,
) {
  const clip = project.clips.find((clip) => clip.id === clipId);
  return clip?.groupId ? recordingGroups(project).get(clip.groupId) : undefined;
}

/** Repair older recording groups on release, without moving unrelated tracks. */
export function releasedRecordingTracks(
  project: Project,
  selected: Set<string>,
) {
  let tracks = project.tracks;
  for (const groupId of recordingGroups(project).keys()) {
    const members = project.clips.filter((clip) => clip.groupId === groupId);
    if (!members.every((clip) => selected.has(clip.id))) continue;
    const owned = new Map(members.map((clip) => [clip.trackId, clip]));
    // A shared track must retain its position for the other clips on it.
    if (
      project.clips.some(
        (clip) => owned.has(clip.trackId) && clip.groupId !== groupId,
      )
    )
      continue;
    const rank = (id: string) => {
      const role = owned.get(id)!.recordingRole;
      return role === "camera"
        ? 0
        : role === "screen"
          ? 1
          : role === "microphone"
            ? 2
            : 3;
    };
    const ordered = tracks
      .filter((track) => owned.has(track.id))
      .sort((a, b) => rank(a.id) - rank(b.id));
    let index = 0;
    tracks = tracks.map((track) =>
      owned.has(track.id) ? ordered[index++] : track,
    );
  }
  return tracks;
}

export function recordingTimeline(project: Project) {
  const groups = recordingGroups(project);
  const hidden = new Set(
    project.clips
      .filter(
        (clip) =>
          clip.groupId &&
          groups.has(clip.groupId) &&
          groups.get(clip.groupId)!.id !== clip.id,
      )
      .map((clip) => clip.id),
  );
  const clips = project.clips.filter((clip) => !hidden.has(clip.id));
  const occupied = new Set(clips.map((clip) => clip.trackId));
  const hiddenTracks = new Set(
    project.clips
      .filter((clip) => hidden.has(clip.id))
      .map((clip) => clip.trackId),
  );
  return {
    clips,
    hidden,
    tracks: project.tracks.filter(
      (track) => !hiddenTracks.has(track.id) || occupied.has(track.id),
    ),
  };
}

function backgroundTransform(project: Project, asset: Asset) {
  const fit = Math.min(
    project.canvas.width / asset.width,
    project.canvas.height / asset.height,
  );
  return {
    ...defaultTransform,
    scale:
      Math.max(
        project.canvas.width / asset.width,
        project.canvas.height / asset.height,
      ) / fit,
  };
}

/** Recover the current edited camera, so changing framing never discards its path. */
function contentFrames(
  project: Project,
  screen: Clip,
  asset: Asset,
): Clip["keyframes"] {
  if (!screen.recording?.zoomBackground) return screen.keyframes;
  const fit = Math.min(
    project.canvas.width / asset.width,
    project.canvas.height / asset.height,
  );
  const width =
    (asset.width * fit * screen.transform.scale) / project.canvas.width;
  const height =
    (asset.height * fit * screen.transform.scale) / project.canvas.height;
  return screen.keyframes.map((frame) => ({
    ...frame,
    value: {
      ...frame.value,
      x: screen.transform.x,
      y: screen.transform.y,
      scale: screen.transform.scale,
      contentScale: frame.value.scale / screen.transform.scale,
      contentX:
        (frame.value.x -
          0.5 -
          ((screen.transform.x - 0.5) * frame.value.scale) /
            screen.transform.scale) /
        width,
      contentY:
        (frame.value.y -
          0.5 -
          ((screen.transform.y - 0.5) * frame.value.scale) /
            screen.transform.scale) /
        height,
    },
  }));
}

/** One style change is one undo step, including background insertion/replacement. */
export function updateRecordingObject(
  project: Project,
  id: string,
  patch: Partial<RecordingSettings>,
  background?: Asset,
): Project {
  const screen = recordingMaster(project, id);
  if (!screen?.recording || !screen.groupId) return project;
  const members = project.clips.filter(
    (clip) => clip.groupId === screen.groupId,
  );
  if (
    members.some(
      (clip) =>
        project.tracks.find((track) => track.id === clip.trackId)?.locked,
    )
  )
    return project;
  const source = project.assets.find((asset) => asset.id === screen.assetId);
  if (!source) return project;
  const previous = screen.recording;
  const settings = {
    ...previous,
    cursor: screen.cursorStyle ?? previous.cursor,
    ...patch,
  };
  const oldBackdrop = members.find(
    (clip) => clip.recordingRole === "background",
  );
  const existingAsset = project.assets.find(
    (asset) => asset.id === oldBackdrop?.assetId,
  );
  const backdropAsset = background ?? existingAsset;
  if (settings.background && !backdropAsset) return project;
  const oldScale = screen.transform.scale;
  const scale = settings.background ? 1 - 2 * settings.padding : 1;
  const framingChanged =
    patch.padding !== undefined || patch.background !== undefined;
  const transform = framingChanged
    ? {
        ...screen.transform,
        scale:
          (oldScale * scale) /
          (previous.background ? 1 - 2 * previous.padding : 1),
      }
    : screen.transform;
  let frames = contentFrames(project, screen, source);
  if (patch.autoZoom !== undefined || patch.zoom !== undefined) {
    frames = settings.autoZoom
      ? recordingCameraFrames(
          source,
          { ...screen, transform, animationOffset: 0 },
          settings.zoom,
        )
      : [];
  } else if (framingChanged)
    frames = frames.map((frame) => ({
      ...frame,
      value: {
        ...frame.value,
        scale: (frame.value.scale * transform.scale) / oldScale,
      },
    }));
  const next: Clip = {
    ...screen,
    recording: settings,
    transform,
    ...(patch.cursor ? { cursorStyle: patch.cursor } : {}),
    ...(patch.radius !== undefined
      ? {
          mediaFrame: {
            ...screen.mediaFrame,
            radius: patch.radius,
            unit: "percent" as const,
          },
        }
      : {}),
  };
  const cameraChanged =
    framingChanged ||
    patch.zoomBackground !== undefined ||
    patch.autoZoom !== undefined ||
    patch.zoom !== undefined;
  if (cameraChanged)
    next.keyframes = settings.zoomBackground
      ? sceneRecordingFrames(frames, next, source, project.canvas, transform)
      : frames;
  if (patch.autoZoom !== undefined || patch.zoom !== undefined)
    next.animationOffset = 0;
  let clips = project.clips.map((clip) =>
    clip.id === screen.id ? next : clip,
  );
  let tracks = project.tracks,
    assets = project.assets;
  if (!settings.background) {
    clips = clips.filter((clip) => clip.id !== oldBackdrop?.id);
  } else if (backdropAsset) {
    if (!assets.some((asset) => asset.id === backdropAsset.id))
      assets = [...assets, backdropAsset];
    let backdrop: Clip;
    const base = backgroundTransform(project, backdropAsset);
    if (oldBackdrop) {
      backdrop = {
        ...oldBackdrop,
        assetId: backdropAsset.id,
        kind: backdropAsset.kind,
        loop: backdropAsset.kind === "video",
        volume: 0,
        transform: base,
        keyframes: oldBackdrop.keyframes.map((frame) => ({
          ...frame,
          value: {
            ...frame.value,
            scale:
              (frame.value.scale * base.scale) / oldBackdrop.transform.scale,
          },
        })),
      };
      if (background) {
        backdrop.sourceIn = 0;
        backdrop.speed = 1;
      }
    } else {
      const owner = project.tracks.find((track) => track.id === screen.trackId);
      const track = {
        ...newTrack(project.tracks.length),
        hidden: !!owner?.hidden,
        muted: !!owner?.muted,
        solo: owner?.solo,
        name: "录屏背景",
        customName: true,
      };
      const insertion =
        Math.max(
          ...members.map((member) =>
            tracks.findIndex((track) => track.id === member.trackId),
          ),
        ) + 1;
      tracks = [
        ...tracks.slice(0, insertion),
        track,
        ...tracks.slice(insertion),
      ];
      backdrop = {
        id: uid(),
        groupId: screen.groupId,
        recordingRole: "background",
        trackId: track.id,
        assetId: backdropAsset.id,
        kind: backdropAsset.kind,
        name: "录屏背景",
        start: screen.start,
        duration: screen.duration,
        sourceIn: 0,
        speed: 1,
        volume: 0,
        podcast: false,
        loop: backdropAsset.kind === "video",
        transform: base,
        keyframes: [],
      };
    }
    if (cameraChanged || !oldBackdrop) {
      backdrop.animationOffset = next.animationOffset;
      backdrop.keyframes = settings.zoomBackground
        ? sceneRecordingFrames(frames, next, source, project.canvas, base)
        : [];
    }
    clips = oldBackdrop
      ? clips.map((clip) => (clip.id === oldBackdrop.id ? backdrop : clip))
      : [...clips, backdrop];
  }
  // Remove only the empty track owned by a disabled background.
  if (
    !settings.background &&
    oldBackdrop &&
    !clips.some((clip) => clip.trackId === oldBackdrop.trackId)
  )
    tracks = tracks.filter((track) => track.id !== oldBackdrop.trackId);
  return { ...project, clips, tracks, assets };
}

export function trimRecordingObject(
  project: Project,
  before: Clip,
  after: Clip,
): Project {
  if (!recordingMaster(project, before.id)) return project;
  const left = after.start - before.start;
  const right = before.start + before.duration - after.start - after.duration;
  return {
    ...project,
    clips: project.clips.map((clip) => {
      if (clip.groupId !== before.groupId) return clip;
      if (clip.id === before.id) return after;
      return {
        ...clip,
        start: clip.start + left,
        duration: Math.max(
          1 / project.canvas.fps,
          clip.duration - left - right,
        ),
        sourceIn: clip.sourceIn + left * clip.speed,
        animationOffset: (clip.animationOffset ?? 0) + left,
      };
    }),
  };
}
