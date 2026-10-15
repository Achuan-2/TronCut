import { z } from "zod";
import { captionProcessingSchema } from "./caption-processing";
export const speechEngineSchema = z.enum(["qwen3-asr", "sensevoice"]);
export type SpeechEngine = z.infer<typeof speechEngineSchema>;
export const speechDeviceSchema = z.enum(["auto", "cpu"]);
export const speechOptionsSchema = z.object({
  device: speechDeviceSchema.default("auto"),
  modelDir: z.string().trim().max(4096).default(""),
  offline: z.boolean().default(false),
  sourceIn: z.number().finite().nonnegative().default(0),
  sourceDuration: z.number().finite().positive().optional(),
  processing: captionProcessingSchema.optional(),
});
export type SpeechOptions = z.input<typeof speechOptionsSchema>;
