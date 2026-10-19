export const timelineZoomMin = 0.1;
export const timelineZoomMax = 2400;

/** Reserve room for the playhead's range handle at the end of the timeline. */
export function timelineFitZoom(duration: number, viewportWidth: number) {
  return viewportWidth > 0
    ? Math.max(1, viewportWidth - 24) / Math.max(1, duration)
    : timelineZoomMin;
}

/** Equal slider steps reveal proportional amounts of the current timeline. */
export function timelineZoomFromPercent(percent: number, minimum: number) {
  const maximum = Math.max(minimum, timelineZoomMax);
  const position = Math.max(0, Math.min(100, percent)) / 100;
  return minimum * (maximum / minimum) ** position;
}

export function timelineZoomPercent(zoom: number, minimum: number) {
  const maximum = Math.max(minimum, timelineZoomMax);
  if (maximum === minimum) return 0;
  const position = Math.log(zoom / minimum) / Math.log(maximum / minimum);
  return Math.max(0, Math.min(100, position * 100));
}

/** Keep a visible playhead stationary; bring an offscreen one into view. */
export function timelineZoomScroll(
  playhead: number,
  before: number,
  after: number,
  scrollLeft: number,
  viewportWidth: number,
) {
  const x = playhead * before - scrollLeft;
  const anchor = x >= 0 && x <= viewportWidth ? x : viewportWidth / 2;
  return Math.max(0, playhead * after - anchor);
}

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
    (frames.find((count) => (count / fps) * zoom >= 75) ??
      Math.ceil(75 / zoom / 3600) * 3600 * fps) / fps
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
