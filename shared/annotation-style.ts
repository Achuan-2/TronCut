import { z } from "zod";
import type { Clip } from "./model";

const finite = z.number().finite();
const color = z.string().regex(/^#[\da-f]{6}$/i);
export const annotationShapeSchema = z.enum([
  "rectangle",
  "rounded-rectangle",
  "ellipse",
  "arrow",
  "line",
  "star",
  "octagon",
  "triangle",
  "diamond",
  "check",
  "cross",
  "curved-arrow",
  "freehand",
]);
export const shapeStyleSchema = z.object({
  stroke: color.default("#00b5ef"),
  strokeWidth: finite.min(0).max(100).default(8),
  fillEnabled: z.boolean().default(true),
  lineStyle: z.enum(["solid", "dashed", "dotted"]).default("solid"),
  startHead: z.enum(["none", "arrow", "dot"]).default("none"),
  endHead: z.enum(["none", "arrow", "dot"]).default("none"),
  rough: z.boolean().default(false),
});
export const drawingSchema = z.object({
  enabled: z.boolean().default(true),
  duration: finite.min(0.01).max(86400).default(1),
  delay: finite.min(0).max(86400).default(0),
  frozenProgress: finite.min(0).max(1).optional(),
  points: z
    .array(
      z.object({
        x: finite.min(-32768).max(32768),
        y: finite.min(-32768).max(32768),
      }),
    )
    .min(2)
    .max(20000)
    .optional(),
});
export const annotationEffectSchema = z.object({
  type: z.enum(["blur", "spotlight", "highlight", "pixelate"]),
  amount: finite.min(1).max(200).default(24),
  color: color.default("#fff100"),
  opacity: finite.min(0).max(1).default(0.65),
});
export type AnnotationShape = z.infer<typeof annotationShapeSchema>;
export type ShapeStyle = z.infer<typeof shapeStyleSchema>;
export type Drawing = z.infer<typeof drawingSchema>;
export type AnnotationEffect = z.infer<typeof annotationEffectSchema>;
export type Point = { x: number; y: number };
export const defaultShapeSize = { width: 600, height: 300 };
export function shapeSize(clip: Pick<Clip, "shapeSize">) {
  return clip.shapeSize ?? defaultShapeSize;
}
export function drawingProgress(
  clip: Pick<Clip, "drawing" | "animationOffset">,
  time: number,
) {
  const drawing = clip.drawing;
  if (drawing?.frozenProgress !== undefined) return drawing.frozenProgress;
  return !drawing?.enabled
    ? 1
    : Math.max(
        0,
        Math.min(
          1,
          (time + (clip.animationOffset ?? 0) - drawing.delay) /
            drawing.duration,
        ),
      );
}

type ShapePath = {
  points: Point[];
  closed?: boolean;
  fill?: string;
  stroke?: string;
  width?: number;
  solid?: boolean;
};
const point = (x: number, y: number): Point => ({ x, y });
function polygon(count: number, radius: number, inner = radius) {
  return Array.from({ length: count }, (_, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    const r = i % 2 ? inner : radius;
    return point(300 + Math.cos(angle) * r, 150 + Math.sin(angle) * r * 0.95);
  });
}
export function annotationPaths(
  clip: Pick<
    Clip,
    | "shape"
    | "shapeStyle"
    | "drawing"
    | "shapeSize"
    | "fill"
    | "annotationEffect"
  >,
): ShapePath[] {
  const style = shapeStyleSchema.parse(clip.shapeStyle ?? {});
  const { width, height } = shapeSize(clip);
  const convert = (points: Point[]) =>
    points.map(({ x, y }) => {
      if (clip.shape === "star" || clip.shape === "octagon") {
        const ratio = Math.min(width, height) / 300;
        return point(
          width / 2 + (x - 300) * ratio,
          height / 2 + (y - 150) * ratio,
        );
      }
      return point((x * width) / 600, (y * height) / 300);
    });
  if (clip.shape === "freehand")
    return [
      {
        points: clip.drawing?.points ?? [],
        stroke: style.stroke,
        width: style.strokeWidth,
      },
    ];
  let points: Point[];
  let closed = true;
  switch (clip.shape) {
    case "ellipse":
      points = Array.from({ length: 80 }, (_, i) =>
        point(
          300 + 280 * Math.cos((i * Math.PI) / 40),
          150 + 140 * Math.sin((i * Math.PI) / 40),
        ),
      );
      break;
    case "triangle":
      points = [point(300, 18), point(580, 282), point(20, 282)];
      break;
    case "star":
      points = polygon(10, 140, 60);
      break;
    case "octagon":
      points = polygon(8, 145);
      break;
    case "diamond":
      points = [
        point(300, 15),
        point(580, 150),
        point(300, 285),
        point(20, 150),
      ];
      break;
    case "check":
      points = [point(80, 150), point(230, 265), point(510, 30)];
      closed = false;
      break;
    case "cross":
      return [
        {
          points: convert([point(80, 30), point(520, 270)]),
          stroke: style.stroke,
          width: style.strokeWidth,
        },
        {
          points: convert([point(520, 30), point(80, 270)]),
          stroke: style.stroke,
          width: style.strokeWidth,
        },
      ];
    case "line":
    case "curved-arrow": {
      points =
        clip.shape === "curved-arrow"
          ? Array.from({ length: 30 }, (_, i) => {
              const t = i / 29;
              return point(
                35 + t * 510,
                220 - Math.sin((t * Math.PI) / 2) * 150,
              );
            })
          : [point(35, 150), point(565, 150)];
      const paths: ShapePath[] = [
        {
          points: convert(points),
          stroke: style.stroke,
          width: style.strokeWidth,
        },
      ];
      const head = (
        position: Point,
        other: Point,
        type: ShapeStyle["endHead"],
      ) => {
        const angle = Math.atan2(position.y - other.y, position.x - other.x);
        const length = Math.max(20, style.strokeWidth * 3);
        if (type === "arrow")
          paths.push({
            points: convert([
              point(
                position.x - length * Math.cos(angle - 0.5),
                position.y - length * Math.sin(angle - 0.5),
              ),
              position,
              point(
                position.x - length * Math.cos(angle + 0.5),
                position.y - length * Math.sin(angle + 0.5),
              ),
            ]),
            stroke: style.stroke,
            width: style.strokeWidth,
            solid: true,
          });
        if (type === "dot")
          paths.push({
            points: convert(
              Array.from({ length: 24 }, (_, i) =>
                point(
                  position.x + Math.cos((i * Math.PI) / 12) * style.strokeWidth,
                  position.y + Math.sin((i * Math.PI) / 12) * style.strokeWidth,
                ),
              ),
            ),
            closed: true,
            fill: style.stroke,
          });
      };
      head(points[0], points[1], style.startHead);
      head(
        points.at(-1)!,
        points.at(-2)!,
        clip.shape === "curved-arrow" ? "arrow" : style.endHead,
      );
      return paths;
    }
    case "arrow":
      points = [
        point(15, 110),
        point(420, 110),
        point(420, 25),
        point(585, 150),
        point(420, 275),
        point(420, 190),
        point(15, 190),
      ];
      break;
    case "rounded-rectangle":
      points = [
        [550, 50, -Math.PI / 2],
        [550, 250, 0],
        [50, 250, Math.PI / 2],
        [50, 50, Math.PI],
      ].flatMap(([x, y, angle]) =>
        Array.from({ length: 9 }, (_, i) =>
          point(
            x + Math.cos(angle + (i * Math.PI) / 16) * 35,
            y + Math.sin(angle + (i * Math.PI) / 16) * 35,
          ),
        ),
      );
      break;
    case "rectangle":
    default:
      points = [point(15, 15), point(585, 15), point(585, 285), point(15, 285)];
      break;
  }
  if (style.rough)
    points = points.map((p, i) =>
      point(p.x + Math.sin(i * 9.7) * 3, p.y + Math.cos(i * 6.3) * 3),
    );
  return [
    {
      points: convert(points),
      closed,
      fill: style.fillEnabled ? (clip.fill ?? "#00b5ef") : undefined,
      stroke: style.strokeWidth ? style.stroke : undefined,
      width: style.strokeWidth,
    },
  ];
}
function pathLength(path: ShapePath) {
  const points = path.closed ? [...path.points, path.points[0]] : path.points;
  return points
    .slice(1)
    .reduce(
      (sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y),
      0,
    );
}
function partialPath(path: ShapePath, distance: number) {
  const source = path.closed ? [...path.points, path.points[0]] : path.points;
  const points = source.length ? [source[0]] : [];
  for (let i = 1; i < source.length && distance > 0; i++) {
    const a = source[i - 1],
      b = source[i],
      length = Math.hypot(b.x - a.x, b.y - a.y);
    const ratio = length ? Math.min(1, distance / length) : 1;
    points.push(point(a.x + (b.x - a.x) * ratio, a.y + (b.y - a.y) * ratio));
    distance -= length;
  }
  return points;
}
/** Identical vector geometry is used by canvas, mattes and PNG export frames. */
export function annotationSvgBody(
  clip: Parameters<typeof annotationPaths>[0],
  progress = 1,
): string {
  if (clip.annotationEffect) {
    const { width, height } = shapeSize(clip);
    return clip.shape === "ellipse"
      ? `<ellipse cx="${width / 2}" cy="${height / 2}" rx="${width / 2}" ry="${height / 2}" fill="#ffffff"/>`
      : `<rect width="${width}" height="${height}" fill="#ffffff"/>`;
  }
  const paths = annotationPaths(clip);
  let remaining =
    paths.reduce((sum, path) => sum + pathLength(path), 0) * progress;
  const style = shapeStyleSchema.parse(clip.shapeStyle ?? {});
  return paths
    .map((path) => {
      const length = pathLength(path),
        complete = remaining >= length - 1e-6;
      const points = partialPath(path, remaining);
      remaining = Math.max(0, remaining - length);
      if (points.length < 2) return "";
      const d =
        points
          .map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(3)},${p.y.toFixed(3)}`)
          .join(" ") + (complete && path.closed ? " Z" : "");
      const dash =
        style.lineStyle === "solid" || path.solid
          ? ""
          : ` stroke-dasharray="${style.lineStyle === "dotted" ? `1 ${style.strokeWidth * 2.5}` : `${style.strokeWidth * 4} ${style.strokeWidth * 2}`}"`;
      return `<path d="${d}" fill="${complete ? (path.fill ?? "none") : "none"}" stroke="${path.stroke ?? "none"}" stroke-width="${path.width ?? 0}" stroke-linecap="round" stroke-linejoin="round"${dash}/>`;
    })
    .join("");
}

/** A repeating displacement ramp snaps every sample to its cell centre. */
export function pixelateMap(width: number, height: number, block: number) {
  const size = Math.max(2, block);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="x"><stop stop-color="#ff0000"/><stop offset="1" stop-color="#000000"/></linearGradient><linearGradient id="y" x2="0" y2="1"><stop stop-color="#00ff00"/><stop offset="1" stop-color="#000000"/></linearGradient><pattern id="p" width="${size}" height="${size}" patternUnits="userSpaceOnUse"><rect width="${size}" height="${size}" fill="url(#x)"/><rect width="${size}" height="${size}" fill="url(#y)" style="mix-blend-mode:screen"/></pattern></defs><rect width="100%" height="100%" fill="url(#p)"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
