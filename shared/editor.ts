import { shiftVisualEffects, retimeVisualEffects } from "./visual-effects";
import { maskKeys, maskValues } from "./mask-state";
import { shiftMediaFrame, retimeMediaFrame } from "./media-frame";
import {
  type Asset,
  type Clip,
  type Project,
  type Transform,
  uid,
  defaultTransform,
  newTrack,
  numberTracks,
} from "./model";
import { sameTransform } from "./animation-ranges";
import { easeProgress } from "./easing";
import {
  normalizeRotationAxes,
  optionalTransformKeys,
  optionalTransformDefault,
  axisScaleKeys,
} from "./rotation";
import { visualKeys, visualValues } from "./visual-state";
import { fitBehaviorDuration } from "./behaviors";
import { markerEnd } from "./markers";

export function availableTrack(
  project: Pick<Project, "tracks" | "clips">,
  start: number,
  duration: number,
) {
  return project.tracks.find(
    (track) =>
      !track.locked &&
      !track.hidden &&
      !track.captionTrack &&
      !project.clips.some(
        (clip) =>
          clip.trackId === track.id &&
          clip.start < start + duration &&
          clip.start + clip.duration > start,
      ),
  );
}

export function addMediaAssets(
  project: Project,
  assets: Asset[],
  start: number,
  toTimeline = false,
  options: {
    newTrackForImages?: boolean;
    pasteToTop?: boolean;
    trackId?: string;
    imageDuration?: number;
  } = {},
): Project {
  const tracks = [...project.tracks],
    clips = [...project.clips];
  if (toTimeline)
    for (const asset of assets) {
      const duration =
        asset.kind === "image"
          ? (options.imageDuration ?? (asset.duration || 5))
          : asset.duration || 5;
      const pasteVisual = options.pasteToTop && asset.kind !== "audio";
      const top = tracks[0];
      let track = pasteVisual
        ? top &&
          !top.locked &&
          !top.hidden &&
          !clips.some((clip) => clip.trackId === top.id)
          ? top
          : undefined
        : options.newTrackForImages && asset.kind === "image"
          ? undefined
          : availableTrack({ tracks, clips }, start, duration);
      const target = tracks.find(
        (track) =>
          track.id === options.trackId &&
          !track.locked &&
          !track.hidden &&
          !track.captionTrack,
      );
      if (
        target &&
        !clips.some(
          (clip) =>
            clip.trackId === target.id &&
            clip.start < start + duration &&
            clip.start + clip.duration > start,
        )
      )
        track = target;
      if (!track) {
        track = newTrack(tracks.length);
        tracks.unshift(track);
      }
      clips.push({
        id: uid(),
        trackId: track.id,
        assetId: asset.id,
        kind: asset.kind,
        name: asset.name,
        start,
        duration,
        sourceIn: 0,
        speed: 1,
        volume: 1,
        podcast: false,
        transform: { ...defaultTransform },
        keyframes: [],
      });
    }
  const known = new Set(project.assets.map((a) => a.id));
  return {
    ...project,
    tracks: numberTracks(tracks),
    clips,
    assets: [...project.assets, ...assets.filter((a) => !known.has(a.id))],
  };
}

export function transformAt(
  clip: Pick<Clip, "transform" | "keyframes" | "animationOffset" | "rotation"> &
    Partial<Pick<Clip, "crop" | "contentTransform">>,
  localTime: number,
): Transform {
  return createTransformSampler(clip)(localTime);
}

/** Prepare an immutable animation snapshot once, then sample it while playing.
 * transformAt remains an uncached convenience for callers that mutate inputs.
 */
export function createTransformSampler(
  clip: Pick<Clip, "transform" | "keyframes" | "animationOffset" | "rotation"> &
    Partial<Pick<Clip, "crop" | "contentTransform">>,
): (localTime: number) => Transform {
  const frames = [...clip.keyframes].sort((a, b) => a.time - b.time);
  const hasRotation =
    clip.rotation !== undefined ||
    clip.transform.rotation !== undefined ||
    frames.some((frame) => frame.value.rotation !== undefined);
  const axes = (
    ["rotationX", "rotationY", "skew", "z", ...axisScaleKeys] as const
  ).filter(
    (key) =>
      clip.transform[key] !== undefined ||
      frames.some((frame) => frame.value[key] !== undefined),
  );
  const hasVisual = visualKeys.some(
    (key) =>
      clip.transform[key] !== undefined ||
      frames.some((frame) => frame.value[key] !== undefined),
  );
  const hasMask = maskKeys.some((key) => clip.transform[key] !== undefined || frames.some((frame) => frame.value[key] !== undefined));
  const normalize = (value: Transform): Transform => ({
    ...value,
    ...(hasRotation
      ? {
          rotation:
            value.rotation ?? clip.transform.rotation ?? clip.rotation ?? 0,
        }
      : {}),
    ...Object.fromEntries(
      axes.map((key) => [
        key,
        value[key] ?? clip.transform[key] ?? optionalTransformDefault(key),
      ]),
    ),
    ...(hasVisual ? visualValues(clip, value) : {}),
    ...(hasMask ? maskValues(clip, value) : {}),
  });
  const points =
    frames.length && frames[0].time > 0
      ? [{ time: 0, value: clip.transform }, ...frames]
      : frames;
  return (localTime) => {
    localTime += clip.animationOffset ?? 0;
    if (!points.length) return normalize(clip.transform);
    if (localTime <= points[0].time) return normalize(points[0].value);
    // Lower bound preserves the first matching endpoint, including duplicate
    // keyframe times, and works for backward scrubbing without a cursor reset.
    let lo = 1,
      hi = points.length;
    while (lo < hi) {
      const mid = lo + ((hi - lo) >> 1);
      if (localTime <= points[mid].time) hi = mid;
      else lo = mid + 1;
    }
    if (lo < points.length) {
      const a = points[lo - 1],
        b = points[lo];
      const p = Math.max(
        0,
        Math.min(1, (localTime - a.time) / Math.max(0.00001, b.time - a.time)),
      );
      const ease = easeProgress(p, b.easing);
      const from = normalize(a.value),
        to = normalize(b.value);
      const value = Object.fromEntries(
        Object.keys(from).map((key) => {
          const k = key as keyof Transform;
          const start = from[k] ?? 0,
            end = to[k] ?? 0;
          return [k, start + (end - start) * ease];
        }),
      ) as Transform;
      for (const key of axisScaleKeys)
        if (value[key] !== undefined) value[key] = Math.max(0.05, value[key]!);
      return {
        ...value,
        scale: Math.max(0.05, value.scale),
        opacity: Math.max(0, Math.min(1, value.opacity)),
        ...(visualKeys.some((key) => value[key] !== undefined)
          ? visualValues(clip, value)
          : {}),
        ...(maskKeys.some((key) => value[key] !== undefined) ? maskValues(clip, value) : {}),
      };
    }
    return normalize(points.at(-1)!.value);
  };
}
export function setTransform<
  T extends Pick<
    Clip,
    "transform" | "keyframes" | "animationOffset" | "duration"
  >,
>(
  clip: T,
  patch: Partial<Transform>,
  localTime: number,
  auto: boolean,
  animationDuration = 1,
): T {
  if (!auto)
    return {
      ...clip,
      transform: { ...clip.transform, ...patch },
      keyframes: clip.keyframes.map((k) => ({
        ...k,
        value: { ...k.value, ...patch },
      })),
    };
  const local = Math.max(0, Math.min(clip.duration, localTime));
  const time = Math.max(0, local + (clip.animationOffset ?? 0));
  const value = { ...transformAt(clip, local), ...patch };
  const existing = clip.keyframes.find(
    (frame) => Math.abs(frame.time - time) < 1e-6,
  );
  if (existing) return setKeyframeTransform(clip, patch, existing.time);
  const keyframes = clip.keyframes.filter(
    (k) => Math.abs(k.time - time) > 0.001,
  );
  // New automatic animations end at the playhead and last one second. A hold
  // frame separates them from preceding motion; ongoing motion is not replaced.
  const previous = keyframes
    .filter((frame) => frame.time < time)
    .sort((a, b) => a.time - b.time)
    .at(-1);
  const start = Math.max(
    clip.animationOffset ?? 0,
    time - animationDuration,
    previous?.time ?? 0,
  );
  if (
    start < time &&
    !keyframes.some((frame) => Math.abs(frame.time - start) < 1e-6)
  )
    keyframes.push({
      time: start,
      value: transformAt(clip, start - (clip.animationOffset ?? 0)),
    });
  keyframes.push({ time, value });
  return { ...clip, keyframes: keyframes.sort((a, b) => a.time - b.time) };
}
// An explicitly selected endpoint edits one existing frame. It must never fall
// through to setTransform(auto=false), which applies the patch to every frame.
export function setKeyframeTransform<
  T extends Pick<Clip, "transform" | "keyframes"> &
    Partial<Pick<Clip, "rotation">>,
>(clip: T, patch: Partial<Transform>, time: number, initialState = false): T {
  const axes = optionalTransformKeys.filter((key) => patch[key] !== undefined);
  const index = clip.keyframes.findIndex(
    (frame) => Math.abs(frame.time - time) < 1e-6,
  );
  if (index >= 0) {
    const ordered = [...clip.keyframes].sort((a, b) => a.time - b.time);
    const target = clip.keyframes[index];
    const position = ordered.indexOf(target);
    const rotation = clip.transform.rotation ?? clip.rotation ?? 0;
    const held = new Set([target]);
    for (
      let i = position + 1;
      i < ordered.length &&
      !ordered[i].animation &&
      sameTransform(target.value, ordered[i].value, rotation, clip.transform);
      i++
    )
      held.add(ordered[i]);
    const initial = position === 0 || initialState;
    if (initial)
      for (const frame of ordered.slice(0, position)) held.add(frame);
    return {
      ...clip,
      transform: initial ? { ...clip.transform, ...patch } : clip.transform,
      keyframes: clip.keyframes.map((frame) =>
        held.has(frame)
          ? { ...frame, value: { ...frame.value, ...patch } }
          : initial && axes.length
            ? {
                ...frame,
                value: normalizeRotationAxes(clip, frame.value, axes),
              }
            : frame,
      ),
    };
  }
  if (
    time === 0 &&
    clip.keyframes.length &&
    clip.keyframes.every((frame) => frame.time > 0)
  ) {
    return {
      ...clip,
      keyframes: [
        { time: 0, value: { ...clip.transform, ...patch } },
        ...clip.keyframes.map((frame) =>
          axes.length
            ? {
                ...frame,
                value: normalizeRotationAxes(clip, frame.value, axes),
              }
            : frame,
        ),
      ],
      transform: { ...clip.transform, ...patch },
    };
  }
  return clip;
}
export function splitClip(
  project: Project,
  clipId: string,
  time: number,
): Project {
  const clip = project.clips.find((c) => c.id === clipId);
  if (clip && project.tracks.find((t) => t.id === clip.trackId)?.locked)
    return project;
  if (!clip || time <= clip.start || time >= clip.start + clip.duration)
    return project;
  const cut = time - clip.start;
  const left: Clip = fitBehaviorDuration({
    ...clip,
    visualEffects: shiftVisualEffects(clip, 0),
    mediaFrame: shiftMediaFrame(clip, 0),
    duration: cut,
    transitions: clip.transitions
      ? { incoming: clip.transitions.incoming }
      : undefined,
  });
  const right: Clip = fitBehaviorDuration({
    ...clip,
    visualEffects: shiftVisualEffects(clip, cut),
    mediaFrame: shiftMediaFrame(clip, cut),
    id: uid(),
    start: time,
    duration: clip.duration - cut,
    transitions: clip.transitions
      ? { outgoing: clip.transitions.outgoing }
      : undefined,
    sourceIn: clip.sourceIn + cut * clip.speed,
    // Keep the original curve. Rebuilding a smooth curve at the cut would change its acceleration.
    animationOffset: (clip.animationOffset ?? 0) + cut,
  });
  return {
    ...project,
    clips: project.clips.flatMap((c) =>
      c.id === clipId ? [left, right] : [c],
    ),
  };
}
export function changeSpeed(clip: Clip, speed: number): Clip {
  const ratio = clip.speed / speed;
  return fitBehaviorDuration({
    ...clip,
    visualEffects: retimeVisualEffects(clip, ratio),
    mediaFrame: retimeMediaFrame(clip, ratio),
    speed,
    duration: clip.duration * ratio,
    animationOffset: (clip.animationOffset ?? 0) * ratio,
    keyframes: clip.keyframes.map((k) => ({ ...k, time: k.time * ratio })),
  });
}
export function animation(
  clip: Clip,
  type: "fade" | "zoom" | "slide",
  localTime: number,
  animationDuration = 0.6,
): Clip {
  const localStart = Math.max(0, Math.min(localTime, clip.duration - 0.1));
  const start = Math.max(0, localStart + (clip.animationOffset ?? 0));
  const end = Math.max(
    start + 0.01,
    Math.min(clip.duration, localStart + animationDuration) +
      (clip.animationOffset ?? 0),
  );
  const target = transformAt(clip, localStart);
  const from = {
    ...target,
    ...(type === "fade"
      ? { opacity: 0 }
      : type === "zoom"
        ? { scale: target.scale * 0.75 }
        : { x: target.x - 0.18 }),
  };
  return {
    ...clip,
    keyframes: [
      ...clip.keyframes.filter((k) => k.time < start || k.time > end),
      { time: start, value: from },
      { time: end, value: target },
    ].sort((a, b) => a.time - b.time),
  };
}
export function snapTime(
  time: number,
  project: Project,
  excludeId?: string,
  tolerance = 0.12,
): number {
  const points = [
    0,
    ...project.markers.flatMap((marker) => [marker.time, markerEnd(marker)]),
    ...project.clips
      .filter((c) => c.id !== excludeId)
      .flatMap((c) => [c.start, c.start + c.duration]),
  ];
  const nearest = points.reduce(
    (best, point) =>
      Math.abs(point - time) < Math.abs(best - time) ? point : best,
    Infinity,
  );
  return Math.max(0, Math.abs(nearest - time) <= tolerance ? nearest : time);
}
