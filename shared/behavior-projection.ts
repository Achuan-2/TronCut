import type { Clip } from "./model";
import { behaviorGlyphCount, glyphMotion, type GlyphMotion } from "./behaviors";

/** Camera looking at the center of a plane that rotates around its selected edge. */
export function hingeProjection(
  motion: GlyphMotion,
  width: number,
  height: number,
) {
  const { perspectiveX: px, perspectiveY: py } = motion;
  if ((!px && !py) || width <= 0 || height <= 0) return null;
  const x = (motion.rotationX * Math.PI) / 180;
  const y = (motion.rotationY * Math.PI) / 180;
  const distance = 1 / Math.max(Math.abs(px) / width, Math.abs(py) / height);
  const translateX = (Math.sign(px) * (1 - Math.cos(y)) * width) / 2;
  const translateY = (Math.sign(py) * (1 - Math.cos(x)) * height) / 2;
  const translateZ =
    (Math.sign(px) * Math.sin(y) * width -
      Math.sign(py) * Math.sin(x) * height) /
    2;
  const denominator = 1 - translateZ / distance;
  return {
    distance,
    translateX,
    translateY,
    translateZ,
    centerX: translateX / denominator,
    centerY: translateY / denominator,
  };
}

/** Prefix before the existing rotation/scale, with dimensions in display pixels. */
export function behaviorProjectionCss(
  clip: Pick<Clip, "kind" | "text" | "behaviors">,
  time: number,
  width: number,
  height: number,
) {
  const motion = glyphMotion(clip, time, 0, behaviorGlyphCount(clip), "object");
  return hingeProjectionCss(motion, width, height);
}

export function hingeProjectionCss(
  motion: GlyphMotion,
  width: number,
  height: number,
) {
  const projection = hingeProjection(motion, width, height);
  if (!projection) return "";
  const { centerX, centerY, distance, translateX, translateY, translateZ } =
    projection;
  // The outer layer is already positioned at the projected center.
  return `translate(${-centerX}px, ${-centerY}px) perspective(${distance}px) translate3d(${translateX}px, ${translateY}px, ${translateZ}px)`;
}
