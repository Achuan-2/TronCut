import type { Clip } from "./model";

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

// Percentages use a circular radius: 100% is half the viewport's short edge.
export function mediaFrameRadiusPercent(clip: Clip, size: FrameSize) {
  const frame = clip.mediaFrame;
  if (!frame) return 0;
  if (frame.unit === "percent") return frame.radius;
  const maximum = Math.min(size.width, size.height) / 2;
  return maximum > 0 ? Math.min(100, (frame.radius / maximum) * 100) : 0;
}

export function mediaFrameRadii(clip: Clip, size: FrameSize) {
  const frame = clip.mediaFrame;
  const radius =
    frame?.unit === "percent"
      ? (Math.min(size.width, size.height) * frame.radius) / 200
      : (frame?.radius ?? 0);
  return frameCorners.map((corner) =>
    frame?.enabled === false || !frame
      ? 0
      : (frame.corners ?? defaultFrameCorners)[corner]
        ? radius
        : 0,
  );
}
