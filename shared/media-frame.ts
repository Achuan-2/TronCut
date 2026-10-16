import type { Clip } from "./model";
import { effectActive } from "./effect-timing";

export const frameCorners = [
  "topLeft",
  "topRight",
  "bottomRight",
  "bottomLeft",
] as const;
export const defaultFrameCorners = {
  topLeft: true,
  topRight: true,
  bottomRight: true,
  bottomLeft: true,
};
export function supportsMediaFrame(clip: Clip) {
  return clip.kind === "video" || clip.kind === "image";
}
export function addMediaFrame(clip: Clip): Clip {
  if (!supportsMediaFrame(clip) || clip.mediaFrame) return clip;
  return {
    ...clip,
    mediaFrame: {
      radius: 20,
      unit: "percent",
      enabled: true,
      corners: { ...defaultFrameCorners },
    },
  };
}
type FrameSize = { width: number; height: number };

export function roundedRectanglePath(width: number, height: number, radii: number[]) {
  const [tl, tr, br, bl] = radii.map((radius) => Math.min(radius, width / 2, height / 2));
  return `M${tl} 0H${width - tr}Q${width} 0 ${width} ${tr}V${height - br}Q${width} ${height} ${width - br} ${height}H${bl}Q0 ${height} 0 ${height - bl}V${tl}Q0 0 ${tl} 0Z`;
}

// Percentages use a circular radius: 100% is half the viewport's short edge.
export function mediaFrameRadiusPercent(clip: Clip, size: FrameSize) {
  const frame = clip.mediaFrame;
  if (!frame) return 0;
  if (frame.unit === "percent") return frame.radius;
  const maximum = Math.min(size.width, size.height) / 2;
  return maximum > 0 ? Math.min(100, (frame.radius / maximum) * 100) : 0;
}

export function mediaFrameRadii(clip: Clip, size: FrameSize, time = 0) {
  const frame = clip.mediaFrame;
  const radius =
    frame?.unit === "percent"
      ? (Math.min(size.width, size.height) * frame.radius) / 200
      : (frame?.radius ?? 0);
  return frameCorners.map((corner) =>
    !frame || !effectActive(frame, time, clip.duration)
      ? 0
      : (frame.corners ?? defaultFrameCorners)[corner]
        ? radius
        : 0,
  );
}
export function shiftMediaFrame(clip: Clip, offset: number) {
  const frame = clip.mediaFrame;
  if (!frame?.window) return frame;
  return {
    ...frame,
    timing: {
      offset: (frame.timing?.offset ?? 0) + offset,
      duration: frame.timing?.duration ?? clip.duration,
    },
  };
}
export function retimeMediaFrame(clip: Clip, ratio: number) {
  const frame = clip.mediaFrame;
  if (!frame?.window) return frame;
  return {
    ...frame,
    window: { start: frame.window.start * ratio, end: frame.window.end * ratio },
    timing: frame.timing
      ? {
          offset: frame.timing.offset * ratio,
          duration: frame.timing.duration * ratio,
        }
      : undefined,
  };
}
