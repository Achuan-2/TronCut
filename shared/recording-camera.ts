import { type Asset, type Clip, type Transform } from "./model";
import { buildInteractionZoomSuggestions } from "./recordly/zoomSuggestionUtils";
import {
  createCursorFollowCameraState,
  computeCursorFollowFocus,
} from "./recordly/cursorFollowCamera";
import {
  createSpringState,
  getZoomSpringConfig,
  stepSpringValue,
} from "./recordly/motionSmoothing";
import { computeRegionStrength } from "./recordly/zoomRegionUtils";
import type { CursorTelemetryPoint, ZoomRegion } from "./recordly/types";

/** Convert native samples to Recordly telemetry without losing click edges. */
export function recordingTelemetry(
  asset: Asset,
  clip: Clip,
): CursorTelemetryPoint[] {
  let pressed = false;
  return (asset.cursor?.samples ?? [])
    .flatMap((sample) => {
      const click = sample.click && !pressed;
      pressed = sample.click;
      const time = (sample.time - clip.sourceIn) / clip.speed;
      if (
        !sample.visible ||
        !Number.isFinite(time) ||
        time < 0 ||
        time > clip.duration ||
        !Number.isFinite(sample.x) ||
        !Number.isFinite(sample.y) ||
        sample.x < 0 ||
        sample.x > 1 ||
        sample.y < 0 ||
        sample.y > 1
      )
        return [];
      return [
        {
          timeMs: time * 1000,
          cx: sample.x,
          cy: sample.y,
          cursorType: sample.cursorType,
          interactionType: click ? ("click" as const) : ("move" as const),
        },
      ];
    })
    .sort((a, b) => a.timeMs - b.timeMs);
}

type Pose = { time: number; x: number; y: number; scale: number };
/** Bound linear interpolation error, avoiding one editable arrow per video frame. */
function simplify(points: Pose[], tolerance = 0.001): Pose[] {
  if (points.length < 3) return points;
  const keep = new Set([0, points.length - 1]),
    stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = tolerance,
      selected = -1;
    for (let i = a + 1; i < b; i++) {
      const t =
        (points[i].time - points[a].time) / (points[b].time - points[a].time);
      const error = Math.max(
        ...(["x", "y", "scale"] as const).map((key) =>
          Math.abs(
            points[i][key] -
              (points[a][key] + (points[b][key] - points[a][key]) * t),
          ),
        ),
      );
      if (error > worst) {
        worst = error;
        selected = i;
      }
    }
    if (selected >= 0) {
      keep.add(selected);
      stack.push([a, selected], [selected, b]);
    }
  }
  return [...keep].sort((a, b) => a - b).map((i) => points[i]);
}

/** Recordly click clusters, zoom timing, safe-zone camera and analytical springs.
 * Baking once makes backward seeks, export and source splitting deterministic. */
export function recordingCameraFrames(
  asset: Asset,
  clip: Clip,
  zoom: number,
): Clip["keyframes"] {
  if (clip.duration < 1) return [];
  const telemetry = recordingTelemetry(asset, clip);
  const { suggestions } = buildInteractionZoomSuggestions({
    cursorTelemetry: telemetry,
    totalMs: clip.duration * 1000,
    defaultDurationMs: 3000,
  });
  if (!suggestions.length) return [];
  zoom = Math.max(1.2, Math.min(3, zoom));
  const regions: ZoomRegion[] = suggestions.map((r, i) => ({
    id: String(i),
    startMs: r.start,
    endMs: r.end,
    focus: r.focus,
    depth: 3,
    mode: "auto",
  }));
  const poses: Pose[] = [];
  const config = getZoomSpringConfig(0.5);
  const sx = createSpringState(0),
    sy = createSpringState(0),
    ss = createSpringState(1);
  const camera = createCursorFollowCameraState();
  let active = 0;
  const step = 1000 / 60;
  for (let frame = 0; frame <= Math.ceil(clip.duration * 60); frame++) {
    const time = Math.min(clip.duration * 1000, frame * step);
    while (active < regions.length - 1 && time > regions[active].endMs + 1100)
      active++;
    const region = regions[active];
    const strength = computeRegionStrength(region, time);
    const focus = computeCursorFollowFocus(
      camera,
      telemetry,
      time,
      zoom,
      strength,
      region.focus,
    );
    const scale = 1 + (zoom - 1) * strength;
    poses.push({
      time: time / 1000,
      x: stepSpringValue(sx, (0.5 - focus.cx) * zoom * strength, step, config),
      y: stepSpringValue(sy, (0.5 - focus.cy) * zoom * strength, step, config),
      scale: stepSpringValue(ss, scale, step, config),
    });
    // Resting gaps need only their endpoints, including long recordings with
    // sparse clicks. Never skip while a spring still has visible motion.
    const pose = poses.at(-1)!;
    if (strength === 0 && pose.scale === 1 && pose.x === 0 && pose.y === 0) {
      if (time < region.startMs - 1000) {
        frame = Math.max(frame, Math.floor((region.startMs - 1000) / step) - 1);
      } else if (active === regions.length - 1 && time > region.endMs + 2000) {
        poses.push({ time: clip.duration, x: 0, y: 0, scale: 1 });
        break;
      }
    }
  }
  // Complete the return within the clip when the last click is near EOF.
  const tail = Math.min(0.35, clip.duration / 4);
  for (const pose of poses) {
    if (pose.time > clip.duration - tail) {
      const weight = Math.max(0, (clip.duration - pose.time) / tail);
      pose.x *= weight;
      pose.y *= weight;
      pose.scale = 1 + (pose.scale - 1) * weight;
    }
  }
  let reduced = simplify(poses);
  // Stay inside the project's editable-keyframe limit for unusually busy sessions.
  for (let tolerance = 0.002; reduced.length > 9900; tolerance *= 2)
    reduced = simplify(poses, tolerance);
  const frames: Clip["keyframes"] = reduced.map((pose) => ({
    time: pose.time,
    value: {
      ...clip.transform,
      contentX: pose.x || 0,
      contentY: pose.y || 0,
      contentScale: pose.scale,
    },
    easing: "linear" as const,
    recordingZoom: true as const,
  }));
  // Expose two editable arrows per shot; dense spring samples remain inside
  // those ranges instead of overlapping dozens of tiny endpoint handles.
  let segment = 0;
  for (let i = 1; i < frames.length; i++) {
    if ((frames[i].value.contentScale ?? 1) <= 1) continue;
    const start = i - 1;
    let end = i,
      peak = i;
    while (
      end < frames.length - 1 &&
      (frames[end].value.contentScale ?? 1) > 1
    ) {
      if (
        (frames[end].value.contentScale ?? 1) >
        (frames[peak].value.contentScale ?? 1)
      )
        peak = end;
      end++;
    }
    const incoming = ++segment,
      outgoing = ++segment;
    for (let j = start + 1; j <= end; j++)
      frames[j].recordingSegment = j <= peak ? incoming : outgoing;
    i = end;
  }
  return frames;
}

/** Apply the same source camera to the recording frame and its independent backdrop. */
export function sceneRecordingFrames(
  frames: Clip["keyframes"],
  screen: Clip,
  screenSize: { width: number; height: number },
  canvas: { width: number; height: number },
  target: Transform,
): Clip["keyframes"] {
  const fit = Math.min(
    canvas.width / screenSize.width,
    canvas.height / screenSize.height,
  );
  const width =
    (screenSize.width * fit * screen.transform.scale) / canvas.width;
  const height =
    (screenSize.height * fit * screen.transform.scale) / canvas.height;
  return frames.map((frame) => {
    const z = frame.value.contentScale ?? 1;
    return {
      ...frame,
      value: {
        ...target,
        x: 0.5 + (target.x - 0.5) * z + (frame.value.contentX ?? 0) * width,
        y: 0.5 + (target.y - 0.5) * z + (frame.value.contentY ?? 0) * height,
        scale: target.scale * z,
      },
    };
  });
}
