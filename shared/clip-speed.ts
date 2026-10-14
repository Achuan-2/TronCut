import type { Clip } from "./model";
import { changeSpeed } from "./editor";

export const speedLimits = { min: 0.25, max: 8 };

export function supportsClipSpeed(clip: Clip): boolean {
  return clip.kind === "video" || clip.kind === "audio";
}

export function hasClipSpeed(clip: Clip): boolean {
  return (
    supportsClipSpeed(clip) && (clip.speedEffect === true || clip.speed !== 1)
  );
}

export function addClipSpeed(clip: Clip): Clip {
  return supportsClipSpeed(clip) && !clip.speedEffect
    ? { ...clip, speedEffect: true }
    : clip;
}

/** Retain the exact source interval and proportionally retime its animations. */
export function setClipSpeed(clip: Clip, speed: number): Clip {
  if (
    !supportsClipSpeed(clip) ||
    !Number.isFinite(speed) ||
    speed < speedLimits.min ||
    speed > speedLimits.max
  )
    return clip;
  if (clip.speed === speed && clip.speedEffect) return clip;
  const ratio = clip.speed / speed;
  if (clip.duration * ratio > 86400) return clip;
  return {
    ...changeSpeed(clip, speed),
    speedEffect: true,
    ...(clip.fadeIn !== undefined ? { fadeIn: clip.fadeIn * ratio } : {}),
    ...(clip.fadeOut !== undefined ? { fadeOut: clip.fadeOut * ratio } : {}),
  };
}

export function speedDurationBounds(clip: Clip, fps: number) {
  const sourceDuration = clip.duration * clip.speed;
  const max = Math.min(86400, sourceDuration / speedLimits.min);
  return {
    min: Math.min(max, Math.max(1 / fps, sourceDuration / speedLimits.max)),
    max,
  };
}

export function setSpeedDuration(
  clip: Clip,
  duration: number,
  fps: number,
): Clip {
  if (!supportsClipSpeed(clip) || !Number.isFinite(duration) || duration <= 0)
    return clip;
  const bounds = speedDurationBounds(clip, fps);
  const next = Math.max(bounds.min, Math.min(bounds.max, duration));
  return setClipSpeed(
    clip,
    Math.max(
      speedLimits.min,
      Math.min(speedLimits.max, (clip.duration * clip.speed) / next),
    ),
  );
}

export function removeClipSpeed(clip: Clip): Clip {
  if (!hasClipSpeed(clip)) return clip;
  return { ...setClipSpeed(clip, 1), speedEffect: undefined };
}

export function durationParts(duration: number, fps: number) {
  const total = Math.max(0, Math.round(duration * fps));
  return {
    minutes: Math.floor(total / (fps * 60)),
    seconds: Math.floor(total / fps) % 60,
    frames: total % fps,
  };
}
