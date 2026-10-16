import { z } from "zod";
import { defaultCursorStyle } from "./cursor";
import { retiredRecordingBackgrounds } from "./recording-backgrounds";
const finite = z.number().finite();
export const cursorStyleSchema = z.object({
  style: z.enum([
    "arrow",
    "circle",
    "cross",
    "hidden",
    "macos",
    "tahoe",
    "tahoe-inverted",
    "windows11",
    "figma",
    "dot",
  ]),
  size: finite.min(8).max(160),
  color: z.string().regex(/^#[\da-f]{6}$/i),
  clicks: z.boolean(),
  smooth: z.boolean(),
});

export const recordingBackgrounds = {
  "perspective-grid": {
    name: "透视网格（黑）",
    file: "perspective-grid.mp4",
    animated: true,
  },
  "moving-grid": {
    name: "平网格动态",
    file: "moving-grid.mp4",
    animated: true,
  },
  "moving-dots": {
    name: "点状移动",
    file: "moving-dots.mp4",
    animated: true,
  },
  "wave-dots": {
    name: "点状波浪",
    file: "wave-dots.mp4",
    animated: true,
  },
  mint: { name: "薄荷", colors: ["#143e42", "#7bdbc3"] },
  violet: { name: "紫雾", colors: ["#30295b", "#bd9ce4"] },
  sunset: { name: "日落", colors: ["#793c63", "#f6ae7d"] },
  dark: { name: "深灰", colors: ["#111827", "#475569"] },
  blue: { name: "蓝色渐变", colors: ["#a1c4fd", "#c2e9fb"] },
} as const;
export const recordingBackgroundSchema = z.enum([
  "custom",
  ...Object.keys(recordingBackgrounds),
] as [
  keyof typeof recordingBackgrounds | "custom",
  ...(keyof typeof recordingBackgrounds | "custom")[],
]);
export type RecordingBackground = z.infer<typeof recordingBackgroundSchema>;
// Keep enough metadata to remember and preview an imported background on restart.
export const customRecordingBackgroundSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  path: z.string().min(1),
  kind: z.enum(["image", "video"]),
  duration: finite.positive(),
  width: finite.positive(),
  height: finite.positive(),
  hasAudio: z.boolean(),
});
export type CustomRecordingBackground = z.infer<
  typeof customRecordingBackgroundSchema
>;
export const recordingSettingsSchema = z.object({
  background: z.boolean(),
  preset: z.preprocess(
    (value) =>
      typeof value === "string" && retiredRecordingBackgrounds.has(value)
        ? "perspective-grid"
        : value,
    recordingBackgroundSchema,
  ),
  customBackground: customRecordingBackgroundSchema.optional(),
  padding: z.number().finite().min(0).max(0.25),
  radius: z.number().finite().min(0).max(200),
  cursor: cursorStyleSchema,
  autoZoom: z.boolean(),
  zoom: z.number().finite().min(1.2).max(3),
  zoomBackground: z.boolean().default(false),
});
export type RecordingSettings = z.infer<typeof recordingSettingsSchema>;
export const defaultRecordingSettings: RecordingSettings = {
  background: true,
  preset: "perspective-grid",
  padding: 0.08,
  radius: 0,
  cursor: { ...defaultCursorStyle, style: "tahoe", size: 40 },
  autoZoom: true,
  zoom: 1.8,
  zoomBackground: false,
};
