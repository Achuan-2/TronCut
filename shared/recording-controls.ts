import { z } from "zod";
import { cameraStyleSchema } from "./recording-settings";

export const recordingControlsStateSchema = z.object({
  phase: z.enum(["starting", "recording", "paused", "saving"]),
  elapsed: z.number().finite().nonnegative(),
  error: z.string().max(4000),
  cameraStyle: cameraStyleSchema.optional(),
});

export type RecordingControlsState = z.infer<
  typeof recordingControlsStateSchema
>;
export type RecordingControlsViewState = RecordingControlsState & {
  cameraVisible: boolean;
};
export type RecordingControlCommand =
  "pause" | "stop" | "editor" | "minimize" | "camera";
