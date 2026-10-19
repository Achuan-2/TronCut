export const timelineZoomMin = 0.1;
export const timelineZoomMax = 2400;

/** Keep labels readable, and align subsecond divisions to actual video frames. */
export function timelineRulerStep(zoom: number, fps: number) {
  const frames = [
    ...new Set([
      ...[1, 2, 5, 10].filter((count) => count < fps),
      ...[
        0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600,
      ].map((seconds) => Math.max(1, Math.round(seconds * fps))),
    ]),
  ].sort((a, b) => a - b);
  return (
    (frames.find((count) => (count / fps) * zoom >= 75) ?? frames.at(-1)!) / fps
  );
}

export function timelineRulerLabel(time: number, fps: number, step: number) {
  const frame = Math.round(time * fps);
  const seconds = Math.floor(frame / fps);
  const pad = (value: number) => String(value).padStart(2, "0");
  const clock = `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
  return step >= 1
    ? clock
    : `${clock}:${String(frame % fps).padStart(Math.max(2, String(fps - 1).length), "0")}`;
}
