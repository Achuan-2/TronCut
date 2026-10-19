import type { Clip, Transform } from "./model";
import {
  annotationPaths,
  shapeSize,
  shapeStyleSchema,
  type Point,
} from "./annotation-style";
import { localDelta, projectDelta } from "./rotation";

export type LineHandle = "start" | "end" | "bend";
export type LineEdit = Pick<Clip, "shapeSize" | "linePoints"> & {
  value: Transform;
};

export function supportsLineEditing(
  clip: Pick<Clip, "kind" | "shape" | "annotationEffect">,
) {
  return (
    clip.kind === "shape" &&
    !clip.annotationEffect &&
    (clip.shape === "line" || clip.shape === "curved-arrow")
  );
}

export function linePointsFor(
  clip: Parameters<typeof annotationPaths>[0],
): Point[] {
  return annotationPaths(clip)[0].points;
}

/** Samples use a uniform parameter, including legacy authored curves. */
export function lineMidpoint(points: readonly Point[]): Point {
  const index = (points.length - 1) / 2;
  const a = points[Math.floor(index)],
    b = points[Math.ceil(index)];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Reframe the shaft plus arrowhead margin without moving the other endpoint.
 * All deltas are canvas pixels; shape samples remain local normalized geometry.
 */
export function editLine(
  clip: Clip,
  value: Transform,
  handle: LineHandle,
  delta: Point,
  canvas: { width: number; height: number },
  snap = false,
): LineEdit {
  const size = shapeSize(clip);
  let points = linePointsFor(clip);
  if (points.length === 2) {
    const [a, b] = points;
    points = Array.from({ length: 33 }, (_, i) => ({
      x: a.x + ((b.x - a.x) * i) / 32,
      y: a.y + ((b.y - a.y) * i) / 32,
    }));
  }
  const local = localDelta(value, delta, clip.rotation);
  const dx = (local.x / value.scale) * (clip.effects?.flipX ? -1 : 1);
  const dy = (local.y / value.scale) * (clip.effects?.flipY ? -1 : 1);
  points = points.map((p, i) => {
    const t = i / (points.length - 1);
    const weight =
      handle === "start" ? 1 - t : handle === "end" ? t : 4 * t * (1 - t);
    return { x: p.x + dx * weight, y: p.y + dy * weight };
  });
  if (snap && handle !== "bend") {
    const index = handle === "start" ? 0 : points.length - 1;
    const anchor = points[handle === "start" ? points.length - 1 : 0];
    const moving = points[index];
    const length = Math.hypot(moving.x - anchor.x, moving.y - anchor.y);
    const angle =
      (Math.round(
        Math.atan2(moving.y - anchor.y, moving.x - anchor.x) / (Math.PI / 12),
      ) *
        Math.PI) /
      12;
    const correction = {
      x: anchor.x + Math.cos(angle) * length - moving.x,
      y: anchor.y + Math.sin(angle) * length - moving.y,
    };
    points = points.map((p, i) => {
      const weight =
        handle === "start"
          ? 1 - i / (points.length - 1)
          : i / (points.length - 1);
      return { x: p.x + correction.x * weight, y: p.y + correction.y * weight };
    });
  }
  // Include round caps and arrowheads, so preview and export never clip new ink.
  const stroke = shapeStyleSchema.parse(clip.shapeStyle ?? {}).strokeWidth;
  const padding = Math.max(20, stroke * 3) + stroke;
  const left = Math.min(...points.map((p) => p.x)) - padding;
  const top = Math.min(...points.map((p) => p.y)) - padding;
  const width = Math.max(...points.map((p) => p.x)) + padding - left;
  const height = Math.max(...points.map((p) => p.y)) + padding - top;
  if (width > 32768 || height > 32768) {
    return { value, shapeSize: size, linePoints: clip.linePoints };
  }
  const shift = projectDelta(
    value,
    {
      x:
        (left + width / 2 - size.width / 2) *
        value.scale *
        (clip.effects?.flipX ? -1 : 1),
      y:
        (top + height / 2 - size.height / 2) *
        value.scale *
        (clip.effects?.flipY ? -1 : 1),
    },
    clip.rotation,
  );
  const x = value.x + shift.x / canvas.width,
    y = value.y + shift.y / canvas.height;
  if (Math.abs(x) > 4 || Math.abs(y) > 4) {
    return { value, shapeSize: size, linePoints: clip.linePoints };
  }
  return {
    value: { ...value, x, y },
    shapeSize: { width, height },
    linePoints: points.map((p) => ({
      x: (p.x - left) / width,
      y: (p.y - top) / height,
    })),
  };
}
