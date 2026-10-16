import type { Clip, Transform } from "./model";

export const rotationKeys = ["rotation", "rotationX", "rotationY"] as const;
export const axisScaleKeys = ["scaleX", "scaleY"] as const;
export const optionalTransformKeys = [
  ...rotationKeys,
  "skew",
  "z",
  ...axisScaleKeys,
] as const;
export const optionalTransformDefault = (
  key: (typeof optionalTransformKeys)[number],
) => (key === "scaleX" || key === "scaleY" ? 1 : 0);
// Z is measured in canvas pixels, with the virtual camera 2000px from the plane.
export function depthScale(z = 0) {
  return 2000 / (2000 - Math.max(-10000, Math.min(1000, z)));
}
export function normalizeRotationAxes(
  clip: Pick<Clip, "transform"> & Partial<Pick<Clip, "rotation">>,
  value: Transform,
  keys: readonly (typeof optionalTransformKeys)[number][],
): Transform {
  return {
    ...value,
    ...Object.fromEntries(
      keys.map((key) => [
        key,
        value[key] ??
          clip.transform[key] ??
          (key === "rotation"
            ? (clip.rotation ?? 0)
            : optionalTransformDefault(key)),
      ]),
    ),
  };
}

// Orthographic projection of the same Z -> Y -> X rotation used by the canvas.
// Keeping the projection shared also makes drag deltas follow a tilted plane.
export function rotationMatrix(value: Transform, fallbackZ = 0) {
  const x = ((value.rotationX ?? 0) * Math.PI) / 180;
  const y = ((value.rotationY ?? 0) * Math.PI) / 180;
  const z = ((value.rotation ?? fallbackZ) * Math.PI) / 180;
  const cx = Math.cos(x),
    sx = Math.sin(x),
    cy = Math.cos(y),
    sy = Math.sin(y),
    cz = Math.cos(z),
    sz = Math.sin(z);
  const shear = Math.tan(((value.skew ?? 0) * Math.PI) / 180);
  const depth = depthScale(value.z);
  return {
    a: cz * cy * depth * (value.scaleX ?? 1),
    b: sz * cy * depth * (value.scaleX ?? 1),
    c: (cz * cy * shear + cz * sy * sx - sz * cx) * depth * (value.scaleY ?? 1),
    d: (sz * cy * shear + sz * sy * sx + cz * cx) * depth * (value.scaleY ?? 1),
  };
}

export function projectDelta(
  value: Transform,
  delta: { x: number; y: number },
  fallbackZ = 0,
) {
  const { a, b, c, d } = rotationMatrix(value, fallbackZ);
  return { x: a * delta.x + c * delta.y, y: b * delta.x + d * delta.y };
}

export function localDelta(
  value: Transform,
  delta: { x: number; y: number },
  fallbackZ = 0,
) {
  const { a, b, c, d } = rotationMatrix(value, fallbackZ),
    determinant = a * d - b * c;
  if (Math.abs(determinant) < 1e-6) return { x: 0, y: 0 };
  return {
    x: (d * delta.x - c * delta.y) / determinant,
    y: (a * delta.y - b * delta.x) / determinant,
  };
}
