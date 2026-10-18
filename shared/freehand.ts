import type { AnnotationTemplate } from "./annotations";
import {
  shapeSize,
  shapeStyleSchema,
  type DrawingStroke,
} from "./annotation-style";
import type { Clip } from "./model";
import { transformAt } from "./editor";
import { localDelta, projectDelta } from "./rotation";

export const penBrushes = [
  { id: "round", name: "圆头笔" },
  { id: "marker", name: "荧光笔" },
  { id: "pencil", name: "铅笔" },
  { id: "calligraphy", name: "书法笔" },
  { id: "neon", name: "霓虹笔" },
] as const;
export type PenBrush = (typeof penBrushes)[number]["id"];
export type PenSettings = {
  color: string;
  width: number;
  brush: PenBrush;
  animate: boolean;
  duration: number;
};

type CanvasSize = { width: number; height: number };
type Bounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

function sourceStrokes(clip: Clip): DrawingStroke[] {
  const drawing = clip.drawing;
  if (!drawing) return [];
  if (drawing.strokes?.length) return drawing.strokes;
  return drawing.points?.length
    ? [{ points: drawing.points, style: clip.shapeStyle }]
    : [];
}

function strokeBounds(
  strokes: DrawingStroke[],
  fallbackWidth: number,
): Bounds | null {
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const stroke of strokes) {
    const pad = (stroke.style?.strokeWidth ?? fallbackWidth) + 1;
    for (const point of stroke.points) {
      left = Math.min(left, point.x - pad);
      top = Math.min(top, point.y - pad);
      right = Math.max(right, point.x + pad);
      bottom = Math.max(bottom, point.y + pad);
    }
  }
  if (!Number.isFinite(left)) return null;
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

/** Existing stroke points are clip-local; the pen canvas works in canvas pixels. */
export function drawingStrokesToCanvas(
  clip: Clip,
  canvas: CanvasSize,
  localTime: number,
): DrawingStroke[] {
  const size = shapeSize(clip);
  const transform = transformAt(clip, localTime);
  const center = {
    x: transform.x * canvas.width,
    y: transform.y * canvas.height,
  };
  return sourceStrokes(clip).map((stroke) => ({
    ...stroke,
    points: stroke.points.map((point) => {
      const delta = projectDelta(transform, {
        x: point.x - size.width / 2,
        y: point.y - size.height / 2,
      });
      return {
        x: center.x + delta.x * transform.scale,
        y: center.y + delta.y * transform.scale,
      };
    }),
  }));
}

/**
 * Normalize appended canvas strokes back into the clip's local box. The clip
 * center and any keyframed center shift with the new bounds so existing ink
 * stays fixed on the canvas.
 */
export function fitFreehandStrokes(
  clip: Clip,
  strokes: DrawingStroke[],
  canvas: CanvasSize,
  localTime: number,
  fallbackWidth: number,
): Clip {
  if (!clip.drawing || !strokes.length) return clip;
  const size = shapeSize(clip);
  const transform = transformAt(clip, localTime);
  const center = {
    x: transform.x * canvas.width,
    y: transform.y * canvas.height,
  };
  const local = strokes.map((stroke) => ({
    ...stroke,
    points: stroke.points.map((point) => {
      const delta = localDelta(transform, {
        x: (point.x - center.x) / transform.scale,
        y: (point.y - center.y) / transform.scale,
      });
      return {
        x: size.width / 2 + delta.x,
        y: size.height / 2 + delta.y,
      };
    }),
  }));
  const bounds = strokeBounds(local, fallbackWidth);
  if (!bounds) return clip;
  const normalized = local.map((stroke) => ({
    ...stroke,
    points: stroke.points.map((point) => ({
      x: point.x - bounds.left,
      y: point.y - bounds.top,
    })),
  }));
  const localCenterShift = {
    x: bounds.left + bounds.width / 2 - size.width / 2,
    y: bounds.top + bounds.height / 2 - size.height / 2,
  };
  const projected = projectDelta(transform, localCenterShift);
  const shift = {
    x: (projected.x * transform.scale) / canvas.width,
    y: (projected.y * transform.scale) / canvas.height,
  };
  const clamp = (value: number) => Math.max(-4, Math.min(4, value));
  return {
    ...clip,
    shapeSize: { width: bounds.width, height: bounds.height },
    drawing: { ...clip.drawing, strokes: normalized, points: undefined },
    transform: {
      ...clip.transform,
      x: clamp(clip.transform.x + shift.x),
      y: clamp(clip.transform.y + shift.y),
    },
    keyframes: clip.keyframes.map((keyframe) => ({
      ...keyframe,
      value: {
        ...keyframe.value,
        x: clamp(keyframe.value.x + shift.x),
        y: clamp(keyframe.value.y + shift.y),
      },
    })),
  };
}

/** Preserve pen lifts and each stroke's ink inside one editable annotation. */
export function freehandAnnotation(
  strokes: DrawingStroke[],
  settings: PenSettings,
  canvas: { width: number; height: number },
): { template: AnnotationTemplate; position: { x: number; y: number } } | null {
  if (!strokes.length) return null;
  const bounds = strokeBounds(strokes, settings.width);
  if (!bounds) return null;
  const { left, top, width, height } = bounds;
  return {
    position: {
      x: (left + width / 2) / canvas.width,
      y: (top + height / 2) / canvas.height,
    },
    template: {
      kind: "shape",
      shape: "freehand",
      name: "涂鸦",
      size: { width, height },
      style: shapeStyleSchema.parse({
        stroke: settings.color,
        strokeWidth: settings.width,
        brush: settings.brush,
        fillEnabled: false,
      }),
      drawing: {
        enabled: settings.animate,
        duration: settings.duration,
        delay: 0,
        strokes: strokes.map((stroke) => ({
          ...stroke,
          points: stroke.points.map((p) => ({ x: p.x - left, y: p.y - top })),
        })),
      },
    },
  };
}
