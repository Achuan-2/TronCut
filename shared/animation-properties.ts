import type { Clip, Transform } from "./model";
import { transformAt } from "./editor";
import { maskBounds, maskValues } from "./mask-state";
import { visualValues } from "./visual-state";

const scaleKeys = new Set<keyof Transform>([
  "scale",
  "scaleX",
  "scaleY",
  "contentScale",
]);
const bounds: Record<keyof Transform, readonly [number, number]> = {
  ...maskBounds,
  x: [-4, 4],
  y: [-4, 4],
  contentX: [-4, 4],
  contentY: [-4, 4],
  scale: [0.05, 8],
  scaleX: [0.05, 8],
  scaleY: [0.05, 8],
  contentScale: [0.05, 8],
  opacity: [0, 1],
  rotation: [-3600, 3600],
  rotationX: [-3600, 3600],
  rotationY: [-3600, 3600],
  z: [-10000, 1000],
  skew: [-80, 80],
  cropLeft: [0, 0.95],
  cropTop: [0, 0.95],
  cropRight: [0, 0.95],
  cropBottom: [0, 0.95],
};

/** Move/rotate every pose by the same delta; resize by the same ratio.
 * Keep the animation's timing, easing, holds and recorded samples intact.
 */
export function setAllAnimationTransforms(
  clip: Clip,
  patch: Partial<Transform>,
  localTime: number,
): Clip {
  const resolve = (value: Transform): Transform => ({
    rotation: clip.rotation ?? 0,
    rotationX: 0,
    rotationY: 0,
    z: 0,
    skew: 0,
    scaleX: 1,
    scaleY: 1,
    ...clip.transform,
    ...value,
    ...visualValues(clip, value),
    ...maskValues(clip, value),
  });
  const sampled = resolve(transformAt(clip, localTime));
  const changes = (Object.keys(patch) as (keyof Transform)[]).filter(
    (key) =>
      Number.isFinite(patch[key]) &&
      Math.abs(patch[key]! - sampled[key]!) > 1e-9,
  );
  if (!changes.length) return clip;
  const change = (value: Transform) => {
    const before = resolve(value),
      next = { ...value };
    for (const key of changes) {
      const current = before[key]!;
      const adjusted = scaleKeys.has(key)
        ? (current * patch[key]!) / sampled[key]!
        : current + patch[key]! - sampled[key]!;
      const [min, max] = bounds[key];
      next[key] = Math.max(min, Math.min(max, adjusted));
    }
    return next;
  };
  return {
    ...clip,
    transform: change(clip.transform),
    keyframes: clip.keyframes.map((frame) => ({
      ...frame,
      value: change(frame.value),
    })),
  };
}
