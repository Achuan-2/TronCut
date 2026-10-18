import { z } from "zod";
import {
  defaultTransform,
  newText,
  textPresets,
  uid,
  styleSchema,
  type Clip,
} from "./model";
import {
  annotationShapeSchema,
  shapeStyleSchema,
  drawingSchema,
  annotationEffectSchema,
  type ShapeStyle,
} from "./annotation-style";

export const annotationMime = "troncut-annotation";
const templateSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    preset: z
      .number()
      .int()
      .min(0)
      .max(textPresets.length - 1),
    plain: z.boolean().optional(),
    style: styleSchema.optional(),
  }),
  z.object({
    kind: z.literal("shape"),
    shape: annotationShapeSchema,
    style: shapeStyleSchema.optional(),
    drawing: drawingSchema.optional(),
    size: z
      .object({
        width: z.number().finite().min(1).max(32768),
        height: z.number().finite().min(1).max(32768),
      })
      .optional(),
    fill: z
      .string()
      .regex(/^#[\da-f]{6}$/i)
      .optional(),
    name: z.string().max(100).optional(),
  }),
  z.object({
    kind: z.literal("effect"),
    effect: annotationEffectSchema.shape.type,
  }),
]);
export type AnnotationTemplate = z.infer<typeof templateSchema>;

export function parseAnnotation(data: string): AnnotationTemplate | null {
  if (!data || data.length > 2_000_000) return null;
  try {
    return templateSchema.parse(JSON.parse(data));
  } catch {
    return null;
  }
}

export function annotationClip(
  template: AnnotationTemplate,
  trackId: string,
  time: number,
): Clip {
  if (template.kind === "text") {
    const clip = newText(
      trackId,
      time,
      template.preset,
      template.plain ? "文本" : undefined,
    );
    // Embed the style so saved projects and drag payloads are independent of the library.
    if (template.style) clip.style = structuredClone(template.style);
    return template.plain
      ? { ...clip, style: { ...clip.style!, outlineWidth: 0 } }
      : clip;
  }
  const effectNames = {
    blur: "模糊",
    spotlight: "聚光灯",
    highlight: "突出显示",
    pixelate: "像素化",
  };
  const shapeNames: Record<string, string> = {
    rectangle: "矩形",
    "rounded-rectangle": "圆角矩形",
    ellipse: "椭圆",
    arrow: "实心箭头",
    line: "直线",
    star: "五角星",
    octagon: "八边形",
    triangle: "三角形",
    diamond: "菱形",
    check: "勾选",
    cross: "叉号",
    "curved-arrow": "手绘箭头",
    freehand: "涂鸦",
  };
  return {
    id: uid(),
    trackId,
    start: time,
    duration: 5,
    kind: "shape",
    shape: template.kind === "effect" ? "rectangle" : template.shape,
    name:
      template.kind === "effect"
        ? effectNames[template.effect]
        : (template.name ?? shapeNames[template.shape]),
    fill: template.kind === "shape" ? (template.fill ?? "#00b5ef") : "#ffffff",
    ...(template.kind === "shape"
      ? {
          shapeStyle: template.style,
          drawing: template.drawing,
          shapeSize: template.size,
        }
      : {
          annotationEffect: annotationEffectSchema.parse({
            type: template.effect,
          }),
          shapeStyle: shapeStyleSchema.parse({ strokeWidth: 0 }),
        }),
    sourceIn: 0,
    speed: 1,
    volume: 1,
    podcast: false,
    transform: { ...defaultTransform },
    keyframes: [],
  };
}

export interface AnnotationPreset {
  id: string;
  name: string;
  template: AnnotationTemplate;
}
const styled = (
  shape: z.infer<typeof annotationShapeSchema>,
  name: string,
  style: Partial<ShapeStyle> = {},
  fill = "#00b5ef",
): Extract<AnnotationTemplate, { kind: "shape" }> => ({
  kind: "shape",
  shape,
  name,
  fill,
  ...(["star", "octagon"].includes(shape)
    ? { size: { width: 300, height: 300 } }
    : {}),
  style: shapeStyleSchema.parse(style),
});
export const arrowPresets: AnnotationPreset[] = [
  {
    id: "line",
    name: "直线",
    template: styled("line", "直线", { fillEnabled: false }),
  },
  {
    id: "arrow",
    name: "箭头",
    template: styled("line", "箭头", { endHead: "arrow", fillEnabled: false }),
  },
  {
    id: "dotted-double",
    name: "点状双向箭头",
    template: styled("line", "点状双向箭头", {
      startHead: "arrow",
      endHead: "arrow",
      lineStyle: "dotted",
      fillEnabled: false,
    }),
  },
  {
    id: "dashed-arrow",
    name: "虚线箭头",
    template: styled("line", "虚线箭头", {
      endHead: "arrow",
      lineStyle: "dashed",
      fillEnabled: false,
    }),
  },
  {
    id: "double-arrow",
    name: "双向箭头",
    template: styled("line", "双向箭头", {
      startHead: "arrow",
      endHead: "arrow",
      fillEnabled: false,
    }),
  },
  {
    id: "dot-arrow",
    name: "圆点箭头",
    template: styled("line", "圆点箭头", {
      startHead: "dot",
      endHead: "arrow",
      fillEnabled: false,
    }),
  },
  {
    id: "dot-line",
    name: "两端圆点直线",
    template: styled("line", "两端圆点直线", {
      startHead: "dot",
      endHead: "dot",
      fillEnabled: false,
    }),
  },
  {
    id: "block-arrow",
    name: "实心箭头",
    template: styled("arrow", "实心箭头", { strokeWidth: 0 }),
  },
];
export const shapePresets: AnnotationPreset[] = [
  {
    id: "ellipse",
    name: "椭圆",
    template: styled("ellipse", "椭圆", { strokeWidth: 0 }),
  },
  {
    id: "star",
    name: "五角星",
    template: styled("star", "五角星", { strokeWidth: 0 }),
  },
  {
    id: "rounded-rectangle",
    name: "圆角矩形",
    template: styled("rounded-rectangle", "圆角矩形", { strokeWidth: 0 }),
  },
  {
    id: "rectangle",
    name: "矩形",
    template: styled("rectangle", "矩形", { strokeWidth: 0 }),
  },
  {
    id: "dark-outline",
    name: "黑色描边矩形",
    template: styled("rectangle", "黑色描边矩形", {
      stroke: "#101820",
      strokeWidth: 12,
    }),
  },
  {
    id: "light-outline",
    name: "白色描边矩形",
    template: styled("rectangle", "白色描边矩形", {
      stroke: "#ffffff",
      strokeWidth: 12,
    }),
  },
  {
    id: "octagon",
    name: "八边形",
    template: styled("octagon", "八边形", { strokeWidth: 0 }),
  },
  {
    id: "triangle",
    name: "三角形",
    template: styled("triangle", "三角形", { strokeWidth: 0 }),
  },
];
export const sketchPresets: AnnotationPreset[] = [
  ["rough-circle", "手绘圆", "ellipse", true],
  ["rough-rectangle", "手绘矩形", "rectangle", true],
  ["curved-arrow", "手绘箭头", "curved-arrow", true],
  ["check", "勾选", "check", false],
  ["line", "草图直线", "line", false],
  ["circle", "草图圆", "ellipse", false],
  ["rectangle", "草图矩形", "rectangle", false],
  ["cross", "叉号", "cross", false],
  ["star", "草图五角星", "star", false],
  ["arrow", "草图箭头", "arrow", false],
].map(([id, name, shape, rough]) => ({
  id: String(id),
  name: String(name),
  template: {
    ...styled(shape as z.infer<typeof annotationShapeSchema>, String(name), {
      stroke: "#ff2020",
      strokeWidth: ["rough-circle", "rough-rectangle", "check"].includes(
        String(id),
      )
        ? 18
        : 9,
      fillEnabled: false,
      rough: !!rough,
    }),
    kind: "shape",
    shape: shape as z.infer<typeof annotationShapeSchema>,
    ...([
      "ellipse",
      "rectangle",
      "check",
      "cross",
      "star",
      "curved-arrow",
    ].includes(String(shape))
      ? { size: { width: 300, height: 300 } }
      : {}),
    drawing: drawingSchema.parse({}),
  },
}));
export const annotationEffectPresets: AnnotationPreset[] = (
  [
    ["blur", "模糊"],
    ["spotlight", "聚光灯"],
    ["highlight", "突出显示"],
    ["pixelate", "像素化"],
  ] as const
).map(([effect, name]) => ({
  id: effect,
  name,
  template: { kind: "effect", effect },
}));
