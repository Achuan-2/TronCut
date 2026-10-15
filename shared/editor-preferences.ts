import { z } from "zod";
import { defaultRecordingSettings, recordingSettingsSchema } from "./recording";

const seconds = z.number().finite().min(0.1).max(600);
export const programPreferencesSchema = z.object({
  autoRecovery: z.boolean().default(true),
  recoveryDelay: z.number().finite().min(1).max(600).default(2),
  snapping: z.boolean().default(true),
  waveforms: z.boolean().default(true),
  defaultTool: z.enum(["select", "crop"]).default("select"),
  previewZoom: z.enum(["fit", "1", "0.5", "0.75", "0.25"]).default("fit"),
});
export const timingPreferencesSchema = z.object({
  animation: seconds.default(1),
  image: seconds.default(5),
  text: seconds.default(5),
  annotation: seconds.default(5),
  transition: seconds.default(1),
  caption: seconds.default(3),
});
export const projectPreferencesSchema = z.object({
  width: z.number().int().min(16).max(7680).default(1920),
  height: z.number().int().min(16).max(4320).default(1080),
  fps: z.number().int().min(1).max(120).default(30),
  background: z
    .string()
    .regex(/^#[\da-f]{6}$/i)
    .default("#101319"),
});
export const editorPreferencesSchema = z.object({
  program: programPreferencesSchema.default({}),
  timing: timingPreferencesSchema.default({}),
  project: projectPreferencesSchema.default({}),
  recording: recordingSettingsSchema.default(defaultRecordingSettings),
});
export type EditorPreferences = z.infer<typeof editorPreferencesSchema>;
export const defaultEditorPreferences = editorPreferencesSchema.parse({});
