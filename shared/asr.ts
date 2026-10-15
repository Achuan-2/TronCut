import { z } from "zod";
export const speechEngineSchema = z.enum(["qwen3-asr", "sensevoice"]);
export type SpeechEngine = z.infer<typeof speechEngineSchema>;
export const speechOptionsSchema = z.object({
  device: z.enum(["auto", "cpu"]).default("auto"),
  modelDir: z.string().trim().max(4096).default(""),
  offline: z.boolean().default(false),
  sourceIn: z.number().finite().nonnegative().default(0),
  sourceDuration: z.number().finite().positive().optional(),
});
export type SpeechOptions = z.input<typeof speechOptionsSchema>;
