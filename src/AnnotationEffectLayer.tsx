import { useId, useMemo } from "react";
import type { Clip, Transform } from "../shared/model";
import { localDelta } from "../shared/rotation";
import { pixelateMap } from "../shared/annotation-style";

/** SVG displacement samples the real backdrop, including lower text/media. */
export default function AnnotationEffectLayer({
  clip,
  width,
  height,
  scale,
  opacity,
  canvas,
  pose,
  canvasScale,
}: {
  clip: Clip;
  width: number;
  height: number;
  scale: number;
  opacity: number;
  canvas: { width: number; height: number };
  pose: Transform;
  canvasScale: number;
}) {
  const effect = clip.annotationEffect!;
  const id = `annotation-pixels-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const block = Math.max(2, effect.amount * scale);
  const map = useMemo(
    () => pixelateMap(width, height, block),
    [width, height, block],
  );
  const radius = clip.shape === "ellipse" ? "50%" : 0;
  const canvasClip = [
    [0, 0],
    [canvas.width, 0],
    [canvas.width, canvas.height],
    [0, canvas.height],
  ]
    .map(([x, y]) => {
      const p = localDelta(
        pose,
        { x: x - pose.x * canvas.width, y: y - pose.y * canvas.height },
        clip.rotation,
      );
      return `${width / 2 + (p.x * canvasScale) / pose.scale}px ${height / 2 + (p.y * canvasScale) / pose.scale}px`;
    })
    .join(",");
  return (
    <>
      {effect.type === "pixelate" && (
        <svg width="0" height="0" aria-hidden="true">
          <defs>
            <filter
              id={id}
              x="0"
              y="0"
              width={width}
              height={height}
              filterUnits="userSpaceOnUse"
              colorInterpolationFilters="sRGB"
            >
              <feImage
                href={map}
                x="0"
                y="0"
                width={width}
                height={height}
                preserveAspectRatio="none"
                result="grid"
              />
              <feDisplacementMap
                in="SourceGraphic"
                in2="grid"
                scale={block}
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </filter>
          </defs>
        </svg>
      )}
      <div
        className={`annotation-region annotation-${effect.type}`}
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: radius,
          opacity,
          ...(effect.type === "blur"
            ? { backdropFilter: `blur(${effect.amount * scale}px)` }
            : {}),
          ...(effect.type === "pixelate"
            ? { backdropFilter: `url(#${id})` }
            : {}),
          ...(effect.type === "highlight"
            ? { background: effect.color, opacity: effect.opacity * opacity }
            : {}),
          ...(effect.type === "spotlight"
            ? {
                boxShadow: `0 0 0 20000px rgba(0,0,0,${effect.opacity})`,
                clipPath: `polygon(${canvasClip})`,
              }
            : {}),
        }}
      />
    </>
  );
}
