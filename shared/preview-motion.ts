import type { Asset, Clip } from "./model";

const rangeCache = new WeakMap<
  Clip,
  { keyframes: Clip["keyframes"]; start: number; end: number }
>();

function timedEffect(effect: { easeIn?: number; easeOut?: number; window?: unknown; timing?: unknown } | undefined) {
  return !!(
    effect &&
    (effect.easeIn ||
      effect.easeOut ||
      effect.window ||
      effect.timing)
  );
}

/** Whether a preview layer needs to update at this exact clip time. */
export function clipNeedsPreviewFrameAt(
  clip: Clip,
  asset: Asset | undefined,
  localTime: number,
): boolean {
  if (
    clip.kind === "video" ||
    clip.kind === "audio" ||
    !!clip.drawing?.enabled ||
    !!(asset?.cursor?.samples.length) ||
    !!(
      clip.transitions?.incoming?.enabled ||
      clip.transitions?.outgoing?.enabled
    ) ||
    Object.values(clip.visualEffects ?? {}).some(timedEffect) ||
    timedEffect(clip.mediaFrame)
  )
    return true;
  if (
    ((clip.fadeIn ?? 0) > 0 && localTime < clip.fadeIn!) ||
    ((clip.fadeOut ?? 0) > 0 &&
      localTime > clip.duration - clip.fadeOut!)
  )
    return true;
  if (
    clip.behaviors?.some(
      (behavior) =>
        behavior.enabled &&
        localTime >= behavior.start &&
        localTime < behavior.start + behavior.duration,
    )
  )
    return true;
  if (!clip.keyframes.length) return false;
  let range = rangeCache.get(clip);
  if (!range || range.keyframes !== clip.keyframes) {
    const times = clip.keyframes.map((frame) => frame.time);
    range = {
      keyframes: clip.keyframes,
      start: Math.min(0, ...times),
      end: Math.max(...times),
    };
    rangeCache.set(clip, range);
  }
  const time = localTime + (clip.animationOffset ?? 0);
  return time >= range.start && time < range.end;
}
