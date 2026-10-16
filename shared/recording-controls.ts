import { z } from "zod";

export const recordingControlsStateSchema = z.object({
  phase: z.enum(["starting", "recording", "paused", "saving"]),
  elapsed: z.number().finite().nonnegative(),
  error: z.string().max(4000),
});

export type RecordingControlsState = z.infer<
  typeof recordingControlsStateSchema
>;
export type RecordingControlCommand = "pause" | "stop" | "editor" | "minimize";
