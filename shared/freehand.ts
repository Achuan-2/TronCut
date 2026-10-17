import type { AnnotationTemplate } from "./annotations";
import { shapeStyleSchema, type DrawingStroke } from "./annotation-style";

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

/** Preserve pen lifts and each stroke's ink inside one editable annotation. */
export function freehandAnnotation(
  strokes: DrawingStroke[],
  settings: PenSettings,
  canvas: { width: number; height: number },
): { template: AnnotationTemplate; position: { x: number; y: number } } | null {
  if (!strokes.length) return null;
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const stroke of strokes) {
    const pad = (stroke.style?.strokeWidth ?? settings.width) + 1;
    for (const p of stroke.points) {
      left = Math.min(left, p.x - pad);
      top = Math.min(top, p.y - pad);
      right = Math.max(right, p.x + pad);
      bottom = Math.max(bottom, p.y + pad);
    }
  }
  if (!Number.isFinite(left)) return null;
  const width = Math.max(1, right - left),
    height = Math.max(1, bottom - top);
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
