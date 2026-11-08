import { z } from "zod";

/** Keep source identity in app preferences, without storing preview images. */
export const recordingSourceSchema = z.object({
  id: z.string().min(1).max(256),
  name: z.string().max(10000),
  displayId: z.string().max(256).optional(),
});
export type RecordingSource = z.infer<typeof recordingSourceSchema>;

export function resolveRecordingSource<T extends RecordingSource>(
  sources: readonly T[],
  previous?: RecordingSource | null,
): T | undefined {
  if (previous) {
    // Display IDs survive changes to Electron's screen enumeration order.
    if (previous.id.startsWith("screen:") && previous.displayId) {
      const display = sources.find(
        (source) =>
          source.id.startsWith("screen:") &&
          source.displayId === previous.displayId,
      );
      if (display) return display;
    }
    const exact = sources.find((source) => source.id === previous.id);
    if (exact) return exact;
    // A reopened window has a new native ID. Only restore an unambiguous title.
    const kind = previous.id.split(":")[0];
    const named = sources.filter(
      (source) =>
        source.name === previous.name && source.id.startsWith(`${kind}:`),
    );
    if (named.length === 1) return named[0];
  }
  return sources[0];
}
