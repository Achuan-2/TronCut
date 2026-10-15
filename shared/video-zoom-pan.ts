import {
  defaultTransform,
  type Clip,
  type Project,
  type Transform,
} from "./model";
import { clampCamera } from "./canvas";
import { setTransform, transformAt } from "./editor";
import { isTrackActive } from "./tracks";

export function zoomPanVideos(project: Project, time: number) {
  return project.clips.filter(
    (clip) =>
      clip.kind === "video" &&
      time >= clip.start &&
      time <= clip.start + clip.duration &&
      !project.tracks.find((track) => track.id === clip.trackId)?.locked &&
      isTrackActive(project.tracks, clip.trackId),
  );
}

export function videoZoomPanAt(clip: Clip, localTime: number) {
  let value = { ...defaultTransform, opacity: 1 as const };
  const keyframes = [...clip.keyframes]
    .sort((a, b) => a.time - b.time)
    .map((frame) => {
      value = frame.zoomPan ?? value;
      return { ...frame, value };
    });
  return clampCamera(
    transformAt(
      {
        transform: defaultTransform,
        keyframes,
        animationOffset: clip.animationOffset,
      },
      localTime,
    ),
  );
}

export function zoomPanAt(project: Project, time: number) {
  const clips = zoomPanVideos(project, time);
  const clip =
    clips.find((clip) => clip.keyframes.some((frame) => frame.zoomPan)) ??
    clips[0];
  return clip
    ? videoZoomPanAt(clip, time - clip.start)
    : { ...defaultTransform, opacity: 1 as const };
}

function unzoom(value: Transform, view: Transform): Transform {
  return {
    ...value,
    x: view.x + (value.x - 0.5) / view.scale,
    y: view.y + (value.y - 0.5) / view.scale,
    scale: value.scale / view.scale,
  };
}

export function setVideoZoomPan(
  project: Project,
  patch: Partial<Transform>,
  time: number,
): Project {
  const view = clampCamera({ ...zoomPanAt(project, time), ...patch });
  const targets = new Set(zoomPanVideos(project, time).map((clip) => clip.id));
  if (!targets.size) return project;
  return {
    ...project,
    clips: project.clips.map((clip) => {
      if (!targets.has(clip.id)) return clip;
      const local = time - clip.start;
      const base = unzoom(
        transformAt(clip, local),
        videoZoomPanAt(clip, local),
      );
      const changed = setTransform(
        clip,
        {
          x: Math.max(-4, Math.min(4, 0.5 + (base.x - view.x) * view.scale)),
          y: Math.max(-4, Math.min(4, 0.5 + (base.y - view.y) * view.scale)),
          scale: Math.max(0.05, Math.min(8, base.scale * view.scale)),
        },
        local,
        true,
      );
      const timeInCurve = local + (clip.animationOffset ?? 0);
      return {
        ...changed,
        keyframes: changed.keyframes.map((frame) => {
          const before = clip.keyframes.find(
            (original) => original.time === frame.time,
          );
          if (
            Math.abs(frame.time - timeInCurve) < 1e-6 ||
            (before && before.value !== frame.value && frame.time > timeInCurve)
          )
            return { ...frame, zoomPan: view };
          return before
            ? frame
            : {
                ...frame,
                zoomPan: videoZoomPanAt(
                  clip,
                  frame.time - (clip.animationOffset ?? 0),
                ),
              };
        }),
      };
    }),
  };
}

export function clearVideoZoomPan(project: Project): Project {
  return {
    ...project,
    camera: undefined,
    clips: project.clips.map((clip) => {
      if (
        clip.kind !== "video" ||
        !clip.keyframes.some((frame) => frame.zoomPan) ||
        project.tracks.find((track) => track.id === clip.trackId)?.locked
      )
        return clip;
      const first = [...clip.keyframes].sort((a, b) => a.time - b.time)[0];
      return {
        ...clip,
        transform:
          first?.time === 0
            ? unzoom(clip.transform, first.zoomPan ?? defaultTransform)
            : clip.transform,
        keyframes: clip.keyframes.map((frame) => {
          const { zoomPan: _view, ...rest } = frame;
          return {
            ...rest,
            value: unzoom(
              frame.value,
              videoZoomPanAt(clip, frame.time - (clip.animationOffset ?? 0)),
            ),
          };
        }),
      };
    }),
  };
}

export function unzoomVideoPreview(project: Project, time: number): Project {
  return {
    ...project,
    clips: project.clips.map((clip) =>
      clip.kind === "video"
        ? {
            ...clip,
            keyframes: [],
            transform: unzoom(
              transformAt(clip, time - clip.start),
              videoZoomPanAt(clip, time - clip.start),
            ),
          }
        : clip,
    ),
  };
}
