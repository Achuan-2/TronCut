import { z } from "zod";
import type { Clip } from "./model";
import { animationEasings, easeProgress } from "./easing";

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
  brush: z
    .enum(["round", "marker", "pencil", "calligraphy", "neon"])
    .optional(),
});
const drawingPointsSchema = z
  .array(
    z.object({
      x: finite.min(-32768).max(32768),
      y: finite.min(-32768).max(32768),
    }),
  )
  .min(2)
  .max(20000);
export const drawingSchema = z.object({
  enabled: z.boolean().default(true),
  duration: finite.min(0.01).max(86400).default(1),
  delay: finite.min(0).max(86400).default(0),
  frozenProgress: finite.min(0).max(1).optional(),
  easing: z.enum(animationEasings).optional(),
  points: drawingPointsSchema.optional(),
  strokes: z
    .array(
      z.object({
        points: drawingPointsSchema,
        style: shapeStyleSchema.optional(),
      }),
    )
    .min(1)
    .max(1000)
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
export type DrawingStroke = NonNullable<Drawing["strokes"]>[number];
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
          easeProgress(
            (time + (clip.animationOffset ?? 0) - drawing.delay) /
              drawing.duration,
            drawing.easing ?? "linear",
          ),
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
  brush?: ShapeStyle["brush"];
};
const point = (x: number, y: number): Point => ({ x, y });
/** Authored curves preserve a gentle hand-drawn contour during path playback. */
function sketchOutline(shape: "ellipse" | "rectangle" | "check"): Point[] {
  let start =
    shape === "ellipse"
      ? point(150, 28)
      : shape === "check"
        ? point(60, 145)
        : point(28, 28);
  const curves =
    shape === "ellipse"
      ? [
          [96, 23, 46, 67, 31, 123],
          [16, 181, 42, 235, 96, 261],
          [151, 285, 215, 263, 247, 215],
          [281, 162, 261, 102, 219, 59],
          [194, 36, 170, 25, 143, 31],
        ]
      : shape === "check"
        ? [
            [84, 160, 101, 198, 113, 226],
            [132, 160, 188, 80, 244, 48],
          ]
        : [
            [94, 23, 180, 25, 268, 28],
            [270, 100, 265, 185, 267, 266],
            [194, 263, 112, 268, 28, 267],
            [31, 188, 26, 106, 28, 22],
          ];
  const points = [start];
  for (const [cx1, cy1, cx2, cy2, x, y] of curves) {
    for (let i = 1; i <= 20; i++) {
      const t = i / 20,
        u = 1 - t;
      points.push(
        point(
          u ** 3 * start.x +
            3 * u ** 2 * t * cx1 +
            3 * u * t ** 2 * cx2 +
            t ** 3 * x,
          u ** 3 * start.y +
            3 * u ** 2 * t * cy1 +
            3 * u * t ** 2 * cy2 +
            t ** 3 * y,
        ),
      );
    }
    start = point(x, y);
  }
  return points;
}
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
    return (
      clip.drawing?.strokes ?? [{ points: clip.drawing?.points ?? [] }]
    ).map((stroke) => {
      const ink = stroke.style ?? style;
      return {
        points: stroke.points,
        stroke: ink.stroke,
        width: ink.strokeWidth,
        brush: ink.brush,
      };
    });
  let points: Point[];
  let closed = true;
  switch (clip.shape) {
    case "ellipse":
      points = style.rough
        ? sketchOutline("ellipse").map((p) => point(p.x * 2, p.y))
        : Array.from({ length: 80 }, (_, i) =>
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
      points = sketchOutline("check").map((p) => point(p.x * 2, p.y));
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
      points = style.rough
        ? sketchOutline("rectangle").map((p) => point(p.x * 2, p.y))
        : [point(15, 15), point(585, 15), point(585, 285), point(15, 285)];
      break;
  }
  if (style.rough && clip.shape !== "ellipse" && clip.shape !== "rectangle")
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
      brush: style.brush,
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
      const ink = (width: number, color = path.stroke ?? "none", extra = "") =>
        `<path d="${d}" fill="${complete ? (path.fill ?? "none") : "none"}" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${dash}${extra}/>`;
      const width = path.width ?? 0;
      switch (path.brush ?? style.brush) {
        case "marker":
          return `<g opacity="0.45">${ink(width, path.stroke, ' style="stroke-linecap:square"')}</g>`;
        case "pencil":
          return `<g opacity="0.72">${[-0.22, 0, 0.22].map((shift, i) => ink(width * (i === 1 ? 0.28 : 0.13), path.stroke, ` transform="translate(${shift * width},${-shift * width})" opacity="${i === 1 ? 0.8 : 0.5}"`)).join("")}</g>`;
        case "calligraphy": {
          // A flat nib keeps a fixed diagonal orientation as the path changes direction.
          const half = width * 0.42;
          const outline = [
            ...points.map((p) => point(p.x - half, p.y + half)),
            ...points
              .slice()
              .reverse()
              .map((p) => point(p.x + half, p.y - half)),
          ];
          return `<path d="${outline.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(" ")} Z" fill="${path.stroke ?? "none"}"/>${ink(width * 0.16)}`;
        }
        case "neon":
          return (
            ink(width * 1.8, path.stroke, ' opacity="0.12"') +
            ink(width * 1.35, path.stroke, ' opacity="0.28"') +
            ink(width * 0.8) +
            ink(width * 0.28, "#ffffff")
          );
        default:
          return ink(width);
      }
    })
    .join("");
}

/** A repeating displacement ramp snaps every sample to its cell centre. */
export function pixelateMap(width: number, height: number, block: number) {
  const size = Math.max(2, block);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="x"><stop stop-color="#ff0000"/><stop offset="1" stop-color="#000000"/></linearGradient><linearGradient id="y" x2="0" y2="1"><stop stop-color="#00ff00"/><stop offset="1" stop-color="#000000"/></linearGradient><pattern id="p" width="${size}" height="${size}" patternUnits="userSpaceOnUse"><rect width="${size}" height="${size}" fill="url(#x)"/><rect width="${size}" height="${size}" fill="url(#y)" style="mix-blend-mode:screen"/></pattern></defs><rect width="100%" height="100%" fill="url(#p)"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
