import {
  type Asset,
  type Clip,
  type Project,
  type Transform,
  uid,
  defaultTransform,
} from "./model";

export function addMediaAssets(
  project: Project,
  assets: Asset[],
  start: number,
  toTimeline = false,
): Project {
  const tracks = [...project.tracks],
    clips = [...project.clips];
  if (toTimeline)
    for (const asset of assets) {
      const duration = asset.duration || 5,
        kind = asset.kind === "audio" ? "audio" : "visual";
      const available = (track: Project["tracks"][number]) =>
        track.kind === kind &&
        !track.locked &&
        !track.hidden &&
        !clips.some(
          (c) =>
            c.trackId === track.id &&
            c.start < start + duration &&
            c.start + c.duration > start,
        );
      let track =
        tracks.find(
          (t) =>
            t.id === (kind === "audio" ? "audio" : "video") && available(t),
        ) ?? tracks.find(available);
      if (!track) {
        track = {
          id: uid(),
          name: kind === "audio" ? "声音" : "画面",
          kind,
          hidden: false,
          muted: false,
          locked: false,
        };
        tracks.push(track);
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
    tracks,
    clips,
    assets: [...project.assets, ...assets.filter((a) => !known.has(a.id))],
  };
}

export function transformAt(clip: Clip, localTime: number): Transform {
  localTime += clip.animationOffset ?? 0;
  const frames = [...clip.keyframes].sort((a, b) => a.time - b.time);
  if (!frames.length) return clip.transform;
  const points =
    frames[0].time > 0
      ? [{ time: 0, value: clip.transform }, ...frames]
      : frames;
  if (localTime <= points[0].time) return points[0].value;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    if (localTime <= b.time) {
      const p = Math.max(
        0,
        Math.min(1, (localTime - a.time) / Math.max(0.00001, b.time - a.time)),
      );
      const ease = p * p * (3 - 2 * p);
      return Object.fromEntries(
        Object.keys(a.value).map((key) => {
          const k = key as keyof Transform;
          return [k, a.value[k] + (b.value[k] - a.value[k]) * ease];
        }),
      ) as Transform;
    }
  }
  return points.at(-1)!.value;
}
export function setTransform(
  clip: Clip,
  patch: Partial<Transform>,
  localTime: number,
  auto: boolean,
): Clip {
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
  const keyframes = clip.keyframes.filter(
    (k) => Math.abs(k.time - time) > 0.001,
  );
  if (time > 0 && !keyframes.some((k) => k.time === 0))
    keyframes.push({ time: 0, value: { ...clip.transform } });
  keyframes.push({ time, value });
  return { ...clip, keyframes: keyframes.sort((a, b) => a.time - b.time) };
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
  const left: Clip = {
    ...clip,
    duration: cut,
  };
  const right: Clip = {
    ...clip,
    id: uid(),
    start: time,
    duration: clip.duration - cut,
    sourceIn: clip.sourceIn + cut * clip.speed,
    // Keep the original curve. Rebuilding a smooth curve at the cut would change its acceleration.
    animationOffset: (clip.animationOffset ?? 0) + cut,
  };
  return {
    ...project,
    clips: project.clips.flatMap((c) =>
      c.id === clipId ? [left, right] : [c],
    ),
  };
}
export function changeSpeed(clip: Clip, speed: number): Clip {
  const ratio = clip.speed / speed;
  return {
    ...clip,
    speed,
    duration: clip.duration * ratio,
    animationOffset: (clip.animationOffset ?? 0) * ratio,
    keyframes: clip.keyframes.map((k) => ({ ...k, time: k.time * ratio })),
  };
}
export function animation(
  clip: Clip,
  type: "fade" | "zoom" | "slide",
  localTime: number,
): Clip {
  const localStart = Math.max(0, Math.min(localTime, clip.duration - 0.1));
  const start = Math.max(0, localStart + (clip.animationOffset ?? 0));
  const end = Math.max(
    start + 0.01,
    Math.min(clip.duration, localStart + 0.6) + (clip.animationOffset ?? 0),
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
