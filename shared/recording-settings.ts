import { z } from "zod";
import { defaultCursorStyle } from "./cursor";
import { recordlyBackgrounds } from "./recording-backgrounds";
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
    file: "perspective-grid.svg",
    animated: false,
  },
  mint: { name: "薄荷", colors: ["#143e42", "#7bdbc3"] },
  violet: { name: "紫雾", colors: ["#30295b", "#bd9ce4"] },
  sunset: { name: "日落", colors: ["#793c63", "#f6ae7d"] },
  dark: { name: "深灰", colors: ["#111827", "#475569"] },
  ...recordlyBackgrounds,
} as const;
export const recordingBackgroundSchema = z.enum(
  Object.keys(recordingBackgrounds) as [
    keyof typeof recordingBackgrounds,
    ...(keyof typeof recordingBackgrounds)[],
  ],
);
export type RecordingBackground = z.infer<typeof recordingBackgroundSchema>;
export const recordingSettingsSchema = z.object({
  background: z.boolean(),
  preset: recordingBackgroundSchema,
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
  preset: "tahoe-light",
  padding: 0.08,
  radius: 0,
  cursor: { ...defaultCursorStyle, style: "tahoe", size: 40 },
  autoZoom: true,
  zoom: 1.8,
  zoomBackground: false,
};
