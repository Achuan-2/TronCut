export type RecordingMotion = "zoom-in" | "zoom-out" | "pan";
export type RecordingPose = {
  time: number;
  x: number;
  y: number;
  scale: number;
};

/** Group camera samples by actual motion, keeping holds and direction reversals. */
export function recordingMotionSpans(
  poses: readonly RecordingPose[],
  minimumSpeed = 0.002,
) {
  const spans: {
    start: number;
    end: number;
    motion?: RecordingMotion;
    direction: number;
  }[] = [];
  for (let i = 1; i < poses.length; i++) {
    const a = poses[i - 1],
      b = poses[i];
    const dt = b.time - a.time;
    if (dt <= 0) continue;
    const ds = (b.scale - a.scale) / dt;
    const dx = (b.x - a.x) / dt,
      dy = (b.y - a.y) / dt;
    // Below 0.2% of the source per second, spring settling is visually static.
    const motion: RecordingMotion | undefined =
      Math.abs(ds) > minimumSpeed
        ? ds > 0
          ? "zoom-in"
          : "zoom-out"
        : Math.hypot(dx, dy) > minimumSpeed
          ? "pan"
          : undefined;
    const direction =
      motion === "pan"
        ? Math.abs(dx) >= Math.abs(dy)
          ? Math.sign(dx)
          : 2 * Math.sign(dy)
        : 0;
    const last = spans.at(-1);
    if (
      last &&
      last.motion === motion &&
      last.direction === direction &&
      last.end === i - 1
    )
      last.end = i;
    else spans.push({ start: i - 1, end: i, motion, direction });
  }
  return spans;
}
