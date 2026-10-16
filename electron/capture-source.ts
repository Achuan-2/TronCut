import { desktopCapturer } from "electron";

/** Validate a capture target without taking thumbnails of every open window. */
export async function findCaptureSource(sourceId: string) {
  const type = sourceId.startsWith("screen:")
    ? "screen"
    : sourceId.startsWith("window:")
      ? "window"
      : undefined;
  if (!type) return undefined;
  const sources = await desktopCapturer.getSources({
    types: [type],
    thumbnailSize: { width: 0, height: 0 },
    fetchWindowIcons: false,
  });
  return sources.find((source) => source.id === sourceId);
}
