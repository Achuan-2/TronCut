import { z } from "zod";
import {
  defaultTransform,
  newText,
  textPresets,
  uid,
  type Clip,
} from "./model";

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
  }),
  z.object({
    kind: z.literal("shape"),
    shape: z.enum(["rectangle", "ellipse", "arrow"]),
  }),
]);
export type AnnotationTemplate = z.infer<typeof templateSchema>;

export function parseAnnotation(data: string): AnnotationTemplate | null {
  if (!data || data.length > 2048) return null;
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
    return template.plain
      ? { ...clip, style: { ...clip.style!, outlineWidth: 0 } }
      : clip;
  }
  return {
    id: uid(),
    trackId,
    start: time,
    duration: 5,
    kind: "shape",
    shape: template.shape,
    name: { rectangle: "圆角矩形", ellipse: "椭圆", arrow: "箭头" }[
      template.shape
    ],
    fill: "#71e6b5",
    sourceIn: 0,
    speed: 1,
    volume: 1,
    podcast: false,
    transform: { ...defaultTransform },
    keyframes: [],
  };
}
