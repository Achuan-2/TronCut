import { z } from "zod";
export const speechEngineSchema = z.enum([
  "faster-whisper",
  "sensevoice",
  "whisper-cpp",
]);
export type SpeechEngine = z.infer<typeof speechEngineSchema>;
export const speechOptionsSchema = z.object({
  device: z.enum(["auto", "cpu", "cuda"]).default("auto"),
  sourceIn: z.number().finite().nonnegative().default(0),
  sourceDuration: z.number().finite().positive().optional(),
});
export type SpeechOptions = z.input<typeof speechOptionsSchema>;
export function workerArguments(
  engine: Exclude<SpeechEngine, "whisper-cpp">,
  workers: string,
  script: string,
  input: string,
  output: string,
  language: string,
  device: string,
): string[] {
  return [
    "run",
    "--project",
    workers,
    "--extra",
    engine === "sensevoice" ? "sensevoice" : "whisper",
    "python",
    script,
    "--input",
    input,
    "--output",
    output,
    "--language",
    language,
    "--engine",
    engine,
    "--device",
    device,
  ];
}
