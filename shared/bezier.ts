export type BezierPoint = { x: number; y: number };
export type BezierAnchor = BezierPoint & {
  in?: BezierPoint;
  out?: BezierPoint;
  handleMode?: "aligned" | "independent";
};
export type CubicCurve = {
  start: BezierPoint;
  c1: BezierPoint;
  c2: BezierPoint;
  end: BezierPoint;
};
export type PenSegment =
  | { kind: "line"; start: BezierPoint; end: BezierPoint }
  | ({ kind: "cubic" } & CubicCurve);

const mix = (a: BezierPoint, b: BezierPoint, t: number): BezierPoint => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
const format = (value: number) => value.toFixed(3);
const coordinate = (p: BezierPoint) => `${format(p.x)},${format(p.y)}`;

export function penSegments(
  anchors: readonly BezierAnchor[],
  closed: boolean,
): PenSegment[] {
  if (anchors.length < 2) return [];
  const count = closed ? anchors.length : anchors.length - 1;
  return Array.from({ length: count }, (_, index) => {
    const start = anchors[index],
      end = anchors[(index + 1) % anchors.length];
    return start.out || end.in
      ? {
          kind: "cubic",
          start,
          c1: start.out ?? start,
          c2: end.in ?? end,
          end,
        }
      : { kind: "line", start, end };
  });
}

export function cubicPoint(curve: CubicCurve, t: number): BezierPoint {
  const u = 1 - t;
  return {
    x:
      u ** 3 * curve.start.x +
      3 * u ** 2 * t * curve.c1.x +
      3 * u * t ** 2 * curve.c2.x +
      t ** 3 * curve.end.x,
    y:
      u ** 3 * curve.start.y +
      3 * u ** 2 * t * curve.c1.y +
      3 * u * t ** 2 * curve.c2.y +
      t ** 3 * curve.end.y,
  };
}

export function sampleCubic(curve: CubicCurve, steps = 24) {
  return Array.from({ length: steps + 1 }, (_, index) =>
    cubicPoint(curve, index / steps),
  );
}

export function cubicLength(curve: CubicCurve, steps = 24) {
  const points = sampleCubic(curve, steps);
  return points.slice(1).reduce((sum, p, index) => {
    const previous = points[index];
    return sum + Math.hypot(p.x - previous.x, p.y - previous.y);
  }, 0);
}

export function cubicAtDistance(
  curve: CubicCurve,
  distance: number,
  steps = 64,
) {
  if (distance <= 0) return 0;
  let previous = curve.start,
    traversed = 0;
  for (let index = 1; index <= steps; index++) {
    const t = index / steps,
      current = cubicPoint(curve, t),
      length = Math.hypot(current.x - previous.x, current.y - previous.y);
    if (traversed + length >= distance) {
      const ratio = length ? (distance - traversed) / length : 0;
      return (index - 1 + ratio) / steps;
    }
    traversed += length;
    previous = current;
  }
  return 1;
}

export function splitCubic(curve: CubicCurve, t: number) {
  const ab = mix(curve.start, curve.c1, t),
    bc = mix(curve.c1, curve.c2, t),
    cd = mix(curve.c2, curve.end, t),
    abc = mix(ab, bc, t),
    bcd = mix(bc, cd, t),
    middle = mix(abc, bcd, t);
  return {
    left: { start: curve.start, c1: ab, c2: abc, end: middle },
    right: { start: middle, c1: bcd, c2: cd, end: curve.end },
    point: middle,
  };
}

export function samplePenSegment(segment: PenSegment, steps = 24) {
  return segment.kind === "cubic"
    ? sampleCubic(segment, steps)
    : [segment.start, segment.end];
}

const segmentBody = (segment: PenSegment) =>
  segment.kind === "cubic"
    ? `C${coordinate(segment.c1)} ${coordinate(segment.c2)} ${coordinate(segment.end)}`
    : `L${coordinate(segment.end)}`;

export function penSegmentData(segment: PenSegment) {
  return `M${coordinate(segment.start)} ${segmentBody(segment)}`;
}

export function penPathData(anchors: readonly BezierAnchor[], closed = false) {
  if (!anchors.length) return "";
  const segments = penSegments(anchors, closed);
  return (
    `M${coordinate(anchors[0])}` +
    (segments.length ? ` ${segments.map(segmentBody).join(" ")}` : "") +
    (closed && anchors.length > 1 ? " Z" : "")
  );
}
