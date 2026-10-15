import {
  defaultTransform,
  projectDuration,
  type Project,
  type Transform,
} from "./model";
import { setTransform, transformAt } from "./editor";
import { localDelta, projectDelta, rotationMatrix } from "./rotation";

export const resizeHandles = [
  { name: "nw", x: -1, y: -1 },
  { name: "n", x: 0, y: -1 },
  { name: "ne", x: 1, y: -1 },
  { name: "e", x: 1, y: 0 },
  { name: "se", x: 1, y: 1 },
  { name: "s", x: 0, y: 1 },
  { name: "sw", x: -1, y: 1 },
  { name: "w", x: -1, y: 0 },
] as const;
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

// Align the projected frame bounds, including scale, rotation, skew and depth.
export function framePosition(
  value: Transform,
  size: { width: number; height: number },
  canvas: { width: number; height: number },
  horizontal: 0 | 0.5 | 1,
  vertical: 0 | 0.5 | 1,
  fallbackRotation = 0,
): Pick<Transform, "x" | "y"> {
  const { a, b, c, d } = rotationMatrix(value, fallbackRotation);
  const width =
    (Math.abs(a) * size.width + Math.abs(c) * size.height) * value.scale;
  const height =
    (Math.abs(b) * size.width + Math.abs(d) * size.height) * value.scale;
  return {
    x: clamp(horizontal + ((0.5 - horizontal) * width) / canvas.width, -4, 4),
    y: clamp(vertical + ((0.5 - vertical) * height) / canvas.height, -4, 4),
  };
}

// Delta and size are measured in source canvas pixels, before preview/camera zoom.
// Keep the opposite handle anchored while preserving aspect ratio and rotation.
export function resizeTransform(
  value: Transform,
  delta: { x: number; y: number },
  handle: { x: number; y: number },
  size: { width: number; height: number },
  canvas: { width: number; height: number },
  rotation = 0,
): Transform {
  const { x: dx, y: dy } = localDelta(value, delta, rotation);
  const vx = handle.x * size.width,
    vy = handle.y * size.height;
  const scale = clamp(
    value.scale + (dx * vx + dy * vy) / Math.max(1, vx * vx + vy * vy),
    0.05,
    8,
  );
  const shiftX = (vx * (scale - value.scale)) / 2,
    shiftY = (vy * (scale - value.scale)) / 2;
  const shift = projectDelta(value, { x: shiftX, y: shiftY }, rotation);
  return {
    ...value,
    scale,
    x: clamp(value.x + shift.x / canvas.width, -4, 4),
    y: clamp(value.y + shift.y / canvas.height, -4, 4),
  };
}

export function clampCamera(value: Transform): Transform & { opacity: 1 } {
  const scale = clamp(value.scale, 1, 8),
    inset = 0.5 / scale;
  return {
    x: clamp(value.x, inset, 1 - inset),
    y: clamp(value.y, inset, 1 - inset),
    scale,
    opacity: 1,
  };
}
export function cameraAt(
  project: Project,
  time: number,
): Transform & { opacity: 1 } {
  return clampCamera(
    transformAt(
      project.camera ?? { transform: defaultTransform, keyframes: [] },
      time,
    ),
  );
}
export function setCameraTransform(
  project: Project,
  patch: Partial<Transform>,
  time: number,
): Project {
  const value = clampCamera({ ...cameraAt(project, time), ...patch });
  const source = project.camera ?? {
    transform: { ...defaultTransform, opacity: 1 as const },
    keyframes: [],
  };
  const updated = setTransform(
    { ...source, duration: Math.max(projectDuration(project), time) },
    value,
    time,
    true,
    Infinity, // Canvas camera edits retain their existing continuous curve.
  );
  return {
    ...project,
    camera: {
      transform: clampCamera(updated.transform),
      keyframes: updated.keyframes.map((frame) => ({
        ...frame,
        value: clampCamera(frame.value),
      })),
    },
  };
}
