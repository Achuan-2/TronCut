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
      enabled: true,
      corners: { ...defaultFrameCorners },
    },
  };
}
export function mediaFrameRadii(clip: Clip) {
  const frame = clip.mediaFrame;
  return frameCorners.map((corner) =>
    frame?.enabled === false || !frame
      ? 0
      : (frame.corners ?? defaultFrameCorners)[corner]
        ? frame.radius
        : 0,
  );
}
