import type { AnnotationTemplate } from "./annotations";
import {
  shapeSize,
  shapeStyleSchema,
  type Point,
  type ShapeStyle,
} from "./annotation-style";
import type { Clip, Transform } from "./model";
import {
  penSegments,
  samplePenSegment,
  splitCubic,
  type BezierAnchor,
  type BezierPoint,
} from "./bezier";
import { transformAt } from "./editor";
import { localDelta, projectDelta } from "./rotation";

export const maxPolygonPoints = 128;

type CanvasSize = { width: number; height: number };

const copyPoint = (p: BezierPoint): BezierPoint => ({ x: p.x, y: p.y });
const copyAnchor = (anchor: BezierAnchor): BezierAnchor => ({
  ...anchor,
  in: anchor.in ? copyPoint(anchor.in) : undefined,
  out: anchor.out ? copyPoint(anchor.out) : undefined,
});
const distance = (a: BezierPoint, b: BezierPoint) =>
  Math.hypot(a.x - b.x, a.y - b.y);
const validPoint = (p: BezierPoint | undefined) =>
  !p || (Number.isFinite(p.x) && Number.isFinite(p.y));

function cleanAnchors(points: readonly BezierAnchor[]) {
  const cleaned: BezierAnchor[] = [];
  for (const point of points) {
    if (![point, point.in, point.out].every(validPoint)) return [];
    const previous = cleaned.at(-1);
    if (!previous || distance(point, previous) > 0.01)
      cleaned.push(copyAnchor(point));
    else {
      previous.in ??= point.in ? copyPoint(point.in) : undefined;
      previous.out ??= point.out ? copyPoint(point.out) : undefined;
      previous.handleMode ??= point.handleMode;
    }
  }
  const first = cleaned[0],
    last = cleaned.at(-1);
  if (first && last && distance(first, last) <= 0.01) {
    first.in ??= last.in ? copyPoint(last.in) : undefined;
    first.out ??= last.out ? copyPoint(last.out) : undefined;
    first.handleMode ??= last.handleMode;
    cleaned.pop();
  }
  return cleaned;
}

function normalizeAnchor(
  anchor: BezierAnchor,
  left: number,
  top: number,
  width: number,
  height: number,
): BezierAnchor {
  const normalize = (p: BezierPoint) => ({
    x: (p.x - left) / width,
    y: (p.y - top) / height,
  });
  return {
    ...anchor,
    ...normalize(anchor),
    in: anchor.in ? normalize(anchor.in) : undefined,
    out: anchor.out ? normalize(anchor.out) : undefined,
  };
}

export function polygonCanvasPoint(
  relative: Point,
  canvas: CanvasSize,
  camera: Pick<Transform, "x" | "y" | "scale">,
): Point {
  const clamp = (value: number, maximum: number) =>
    Math.max(0, Math.min(maximum, value));
  return {
    x: clamp(
      (camera.x + (relative.x - 0.5) / camera.scale) * canvas.width,
      canvas.width,
    ),
    y: clamp(
      (camera.y + (relative.y - 0.5) / camera.scale) * canvas.height,
      canvas.height,
    ),
  };
}

export function polygonAnnotation(
  points: readonly BezierAnchor[],
  canvas: CanvasSize,
  style: ShapeStyle = shapeStyleSchema.parse({}),
): { template: AnnotationTemplate; position: Point } | null {
  const cleaned = cleanAnchors(points);
  if (cleaned.length < 3 || cleaned.length > maxPolygonPoints) return null;
  const outline = penSegments(cleaned, true).flatMap((segment) =>
    samplePenSegment(segment, 20),
  );
  const area = Math.abs(
    outline.reduce((sum, point, index) => {
      const next = outline[(index + 1) % outline.length];
      return sum + point.x * next.y - next.x * point.y;
    }, 0) / 2,
  );
  if (area < 0.01) return null;
  const pad = style.strokeWidth + 1;
  const geometry = cleaned.flatMap((anchor) =>
    [anchor, anchor.in, anchor.out].filter(
      (point): point is BezierPoint => !!point,
    ),
  );
  const left = Math.min(...geometry.map((point) => point.x)) - pad,
    top = Math.min(...geometry.map((point) => point.y)) - pad,
    right = Math.max(...geometry.map((point) => point.x)) + pad,
    bottom = Math.max(...geometry.map((point) => point.y)) + pad,
    width = right - left,
    height = bottom - top;
  return {
    position: {
      x: (left + width / 2) / canvas.width,
      y: (top + height / 2) / canvas.height,
    },
    template: {
      kind: "shape",
      shape: "polygon",
      name: "自定义形状",
      size: { width, height },
      style: { ...style },
      linePoints: cleaned.map((anchor) =>
        normalizeAnchor(anchor, left, top, width, height),
      ),
    },
  };
}

export function movePenAnchor(
  anchors: readonly BezierAnchor[],
  index: number,
  position: BezierPoint,
) {
  const next = anchors.map(copyAnchor),
    anchor = next[index];
  if (!anchor) return next;
  const delta = { x: position.x - anchor.x, y: position.y - anchor.y };
  anchor.x = position.x;
  anchor.y = position.y;
  for (const handle of [anchor.in, anchor.out])
    if (handle) {
      handle.x += delta.x;
      handle.y += delta.y;
    }
  return next;
}

export function adjustPenHandle(
  anchors: readonly BezierAnchor[],
  index: number,
  side: "in" | "out",
  position: BezierPoint,
  independent = false,
) {
  const next = anchors.map(copyAnchor),
    anchor = next[index];
  if (!anchor) return next;
  if (distance(anchor, position) <= 0.01) {
    delete anchor[side];
    if (!anchor.in && !anchor.out) delete anchor.handleMode;
    return next;
  }
  anchor[side] = copyPoint(position);
  if (independent || anchor.handleMode === "independent") {
    anchor.handleMode = "independent";
    return next;
  }
  anchor.handleMode = "aligned";
  const other = side === "in" ? "out" : "in",
    opposite = anchor[other],
    length = opposite ? distance(anchor, opposite) : distance(anchor, position),
    direction = {
      x: (position.x - anchor.x) / distance(anchor, position),
      y: (position.y - anchor.y) / distance(anchor, position),
    };
  anchor[other] = {
    x: anchor.x - direction.x * length,
    y: anchor.y - direction.y * length,
  };
  return next;
}

export function smoothPenAnchor(
  anchors: readonly BezierAnchor[],
  index: number,
  position: BezierPoint,
) {
  const next = anchors.map(copyAnchor),
    anchor = next[index];
  if (!anchor) return next;
  anchor.in = { x: 2 * anchor.x - position.x, y: 2 * anchor.y - position.y };
  anchor.out = copyPoint(position);
  anchor.handleMode = "aligned";
  return next;
}

export function insertPenAnchor(
  anchors: readonly BezierAnchor[],
  index: number,
  t: number,
  closed: boolean,
) {
  const segments = penSegments(anchors, closed),
    segment = segments[index];
  if (!segment) return anchors.map(copyAnchor);
  const ratio = Math.max(0.05, Math.min(0.95, t)),
    next = anchors.map(copyAnchor),
    endIndex = (index + 1) % anchors.length;
  let inserted: BezierAnchor;
  if (segment.kind === "line") {
    inserted = {
      x: segment.start.x + (segment.end.x - segment.start.x) * ratio,
      y: segment.start.y + (segment.end.y - segment.start.y) * ratio,
    };
  } else {
    const split = splitCubic(segment, ratio);
    next[index].out = copyPoint(split.left.c1);
    next[endIndex].in = copyPoint(split.right.c2);
    inserted = {
      x: split.point.x,
      y: split.point.y,
      in: copyPoint(split.left.c2),
      out: copyPoint(split.right.c1),
      handleMode: "aligned",
    };
  }
  next.splice(index + 1, 0, inserted);
  return next;
}

export function polygonToCanvas(
  clip: Clip,
  canvas: CanvasSize,
  localTime: number,
): BezierAnchor[] {
  if (clip.shape !== "polygon" || !clip.linePoints) return [];
  const size = shapeSize(clip),
    transform = transformAt(clip, localTime),
    center = {
      x: transform.x * canvas.width,
      y: transform.y * canvas.height,
    };
  const convert = (p: BezierPoint) => {
    const delta = projectDelta(transform, {
      x: p.x - size.width / 2,
      y: p.y - size.height / 2,
    });
    return {
      x: center.x + delta.x * transform.scale,
      y: center.y + delta.y * transform.scale,
    };
  };
  return clip.linePoints.map((anchor) => {
    const scaled = {
      ...anchor,
      x: anchor.x * size.width,
      y: anchor.y * size.height,
      in: anchor.in && {
        x: anchor.in.x * size.width,
        y: anchor.in.y * size.height,
      },
      out: anchor.out && {
        x: anchor.out.x * size.width,
        y: anchor.out.y * size.height,
      },
    };
    return {
      ...anchor,
      ...convert(scaled),
      in: scaled.in ? convert(scaled.in) : undefined,
      out: scaled.out ? convert(scaled.out) : undefined,
    };
  });
}

export function fitPolygonAnnotation(
  clip: Clip,
  points: readonly BezierAnchor[],
  canvas: CanvasSize,
  localTime: number,
): Clip | null {
  if (clip.shape !== "polygon") return null;
  const size = shapeSize(clip),
    transform = transformAt(clip, localTime),
    center = {
      x: transform.x * canvas.width,
      y: transform.y * canvas.height,
    };
  const local = points.map((anchor) => {
    const convert = (p: BezierPoint) => {
      const delta = localDelta(transform, {
        x: (p.x - center.x) / transform.scale,
        y: (p.y - center.y) / transform.scale,
      });
      return {
        x: size.width / 2 + delta.x,
        y: size.height / 2 + delta.y,
      };
    };
    return {
      ...anchor,
      ...convert(anchor),
      in: anchor.in ? convert(anchor.in) : undefined,
      out: anchor.out ? convert(anchor.out) : undefined,
    };
  });
  const result = polygonAnnotation(
    local,
    { width: 1, height: 1 },
    shapeStyleSchema.parse(clip.shapeStyle ?? {}),
  );
  if (!result || result.template.kind !== "shape") return null;
  const nextSize = result.template.size,
    linePoints = result.template.linePoints;
  if (!nextSize || !linePoints) return null;
  const localCenterShift = {
      x: result.position.x - size.width / 2,
      y: result.position.y - size.height / 2,
    },
    projected = projectDelta(transform, localCenterShift),
    shift = {
      x: (projected.x * transform.scale) / canvas.width,
      y: (projected.y * transform.scale) / canvas.height,
    },
    clamp = (value: number) => Math.max(-4, Math.min(4, value));
  return {
    ...clip,
    shapeSize: nextSize,
    linePoints,
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
