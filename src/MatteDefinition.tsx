import { useEffect, useMemo, useRef, useState } from "react";
import type { Clip, Project } from "../shared/model";
import { transformAt } from "../shared/editor";
import { transitionTransform } from "../shared/transitions";
import { fadeOpacity, previewFilter, defaultCrop } from "../shared/effects";
import { effectAmount } from "../shared/visual-effects";
import { visualEffectSvg } from "../shared/visual-effect-svg";
import { depthScale } from "../shared/rotation";
import { contentLayout, defaultContentTransform } from "../shared/crop";
import { mediaFrameRadii, roundedRectanglePath } from "../shared/media-frame";
import { visualClipAt } from "../shared/visual-state";
import { textBoxFor } from "./text";
import { textLineHeight, textFillCss, textFillGeometry } from "../shared/text";
import {
  behaviorTransform,
  glyphMotion,
  layoutGlyphs,
  clipsBehaviorText,
} from "../shared/behaviors";

/** SVG masks keep lower tracks editable and avoid flattening the preview scene. */
export default function MatteDefinition({
  id,
  clip: original,
  project,
  time,
  scale,
}: {
  id: string;
  clip: Clip;
  project: Project;
  time: number;
  scale: number;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [source, setSource] = useState("");
  const asset = project.assets.find((asset) => asset.id === original.assetId);
  useEffect(() => {
    let alive = true,
      frame = 0;
    setSource("");
    if (asset?.kind === "image") {
      void window.framecraft
        ?.mediaUrl(asset.id)
        .then((url) => {
          if (alive) setSource(url);
        })
        .catch(() => {});
    } else if (asset?.kind === "video") {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      let last = -1;
      const tick = () => {
        const video = ref.current
          ?.closest(".canvas-scene")
          ?.querySelector<HTMLVideoElement>(
            `[data-clip-id="${original.id}"] video`,
          );
        if (
          video &&
          context &&
          !video.seeking &&
          video.readyState >= 2 &&
          video.currentTime !== last
        ) {
          canvas.width = Math.max(1, Math.round(project.canvas.width * scale));
          canvas.height = Math.max(
            1,
            Math.round((canvas.width * video.videoHeight) / video.videoWidth),
          );
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          try {
            setSource(canvas.toDataURL("image/png"));
            last = video.currentTime;
          } catch {
            /* Wait for an available decoded frame. */
          }
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
    };
  }, [
    asset?.id,
    asset?.path,
    asset?.kind,
    original.id,
    scale,
    project.canvas.width,
  ]);
  const local = Math.max(0, Math.min(original.duration, time - original.start));
  const transform = transformAt(original, local);
  const clip = visualClipAt(original, transform);
  const pose = transitionTransform(
    project,
    clip,
    behaviorTransform(clip, transform, local),
    time,
  );
  const matte = clip.visualEffects!["media-matte"]!;
  const amount = effectAmount(matte, local, clip.duration) * matte.strength;
  const invert = matte.mode.endsWith("invert");
  const crop = clip.crop ?? defaultCrop;
  const fit = asset
    ? Math.min(
        project.canvas.width / Math.max(1, asset.width),
        project.canvas.height / Math.max(1, asset.height),
      )
    : 1;
  const box = clip.kind === "text" ? textBoxFor(clip) : null;
  const glyphs = useMemo(() => {
    if (original.kind !== "text") return null;
    const context = document.createElement("canvas").getContext("2d")!;
    const font = original.style?.fontSize ?? 68;
    context.font = `700 ${font}px "${(original.style?.fontFamily ?? "Microsoft YaHei").replace(/["\\]/g, "")}", "PingFang SC", sans-serif`;
    return layoutGlyphs(
      original.text ?? "",
      font,
      (text) => context.measureText(text).width,
    );
  }, [
    original.kind,
    original.text,
    original.style?.fontSize,
    original.style?.fontFamily,
  ]);
  const sourceWidth = asset
    ? asset.width * fit * scale
    : (box?.width ?? 600) * scale;
  const sourceHeight = asset
    ? asset.height * fit * scale
    : (box?.height ?? 300) * scale;
  const width = sourceWidth * (1 - crop.left - crop.right),
    height = sourceHeight * (1 - crop.top - crop.bottom);
  const layout = contentLayout(
    clip,
    { width: sourceWidth, height: sourceHeight },
    clip.contentTransform ?? defaultContentTransform,
  );
  let radii = mediaFrameRadii(
    clip,
    { width: width / scale, height: height / scale },
    local,
  );
  if (clip.effects?.flipX) radii = [radii[1], radii[0], radii[3], radii[2]];
  if (clip.effects?.flipY) radii = [radii[3], radii[2], radii[1], radii[0]];
  const effectId = `${id}-effect`,
    modeId = `${id}-mode`,
    cropId = `${id}-crop`;
  const effectTime = Object.values(clip.visualEffects ?? {}).some(
    (effect) => effect?.easeIn || effect?.easeOut || effect?.window,
  )
    ? local
    : 0;
  const defs = useMemo(
    () => visualEffectSvg(clip, width, height, scale, effectTime, effectId),
    [
      clip.visualEffects,
      clip.style,
      clip.duration,
      width,
      height,
      scale,
      effectTime,
      effectId,
    ],
  );
  const size = pose.scale * depthScale(pose.z);
  const lines = (clip.text ?? "").split("\n");
  const font = (clip.style?.fontSize ?? 68) * scale;
  const fill = box ? textFillGeometry(clip.style, box) : null;
  const filter = previewFilter(clip).replace(
    `blur(${clip.effects?.blur ?? 0}px)`,
    `blur(${(clip.effects?.blur ?? 0) * scale}px)`,
  );
  return (
    <svg ref={ref} className="effect-svg-definitions" aria-hidden="true">
      <defs>
        <defs dangerouslySetInnerHTML={{ __html: defs }} />
        <clipPath id={cropId}>
          <path
            d={roundedRectanglePath(
              width,
              height,
              radii.map((radius) => radius * scale),
            )}
          />
        </clipPath>
        <clipPath id={`${id}-text-clip`}>
          <rect width={width} height={height} />
        </clipPath>
        <filter
          id={modeId}
          x={0}
          y={0}
          width={project.canvas.width * scale}
          height={project.canvas.height * scale}
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          {matte.mode.startsWith("luma") && (
            <>
              <feColorMatrix type="luminanceToAlpha" result="matte-luma" />
              <feComposite in="matte-luma" in2="SourceGraphic" operator="in" />
            </>
          )}
          <feComponentTransfer>
            <feFuncA
              type="linear"
              slope={invert ? -amount : amount}
              intercept={invert ? 1 : 1 - amount}
            />
          </feComponentTransfer>
        </filter>
        <mask
          id={id}
          x={0}
          y={0}
          width={project.canvas.width * scale}
          height={project.canvas.height * scale}
          maskUnits="userSpaceOnUse"
          style={{ maskType: "alpha" }}
        >
          <g filter={`url(#${modeId})`}>
            <g
              style={{
                transform: `translate(${pose.x * project.canvas.width * scale}px, ${pose.y * project.canvas.height * scale}px) rotate(${pose.rotation ?? clip.rotation ?? 0}deg) rotateY(${pose.rotationY ?? 0}deg) rotateX(${pose.rotationX ?? 0}deg) scale(${size * (pose.scaleX ?? 1)}, ${size * (pose.scaleY ?? 1)}) skewX(${pose.skew ?? 0}deg) translate(${-width / 2}px, ${-height / 2}px)`,
                opacity: pose.opacity * fadeOpacity(clip, local),
              }}
            >
              <g filter={defs ? `url(#${effectId})` : undefined}>
                {fill && (
                  <rect
                    x={-fill.paddingX * scale}
                    y={-fill.paddingY * scale}
                    width={fill.width * scale}
                    height={fill.height * scale}
                    rx={fill.radius * scale}
                    fill={textFillCss(clip.style)}
                  />
                )}
                {asset ? (
                  <g clipPath={`url(#${cropId})`}>
                    {source && (
                      <image
                        href={source}
                        x={layout.left}
                        y={layout.top}
                        width={layout.width}
                        height={layout.height}
                        preserveAspectRatio="none"
                        style={{
                          filter,
                          transformOrigin: `${width / 2}px ${height / 2}px`,
                          transform: `scale(${clip.effects?.flipX ? -1 : 1},${clip.effects?.flipY ? -1 : 1})`,
                        }}
                      />
                    )}
                  </g>
                ) : box ? (
                  <g
                    fontFamily={clip.style?.fontFamily}
                    fontSize={font}
                    fontWeight="700"
                    fill={clip.style?.color}
                    stroke={clip.style?.outline}
                    strokeWidth={(clip.style?.outlineWidth ?? 0) * scale}
                    paintOrder="stroke fill"
                    textAnchor="middle"
                  >
                    {glyphs && clip.behaviors?.length ? (
                      <g
                        clipPath={
                          clipsBehaviorText(clip, local, glyphs.count)
                            ? `url(#${id}-text-clip)`
                            : undefined
                        }
                      >
                        {glyphs.glyphs.map((glyph) => {
                          const motion = glyphMotion(
                            clip,
                            local,
                            glyph.index,
                            glyphs.count,
                            "text",
                          );
                          return (
                            <text
                              key={glyph.index}
                              dominantBaseline="central"
                              opacity={motion.opacity}
                              style={{
                                transform: `translate(${(width - glyphs.width * scale) / 2 + (glyph.x + motion.x * (clip.style?.fontSize ?? 68)) * scale}px, ${(height - glyphs.height * scale) / 2 + (glyph.y + motion.y * (clip.style?.fontSize ?? 68)) * scale}px) rotate(${motion.rotation}deg) rotateY(${motion.rotationY}deg) rotateX(${motion.rotationX}deg) scale(${motion.scale})`,
                              }}
                            >
                              {glyph.text}
                            </text>
                          );
                        })}
                      </g>
                    ) : (
                      lines.map((line, index) => (
                        <text
                          key={index}
                          x={width / 2}
                          y={
                            height / 2 +
                            (index - (lines.length - 1) / 2) *
                              font *
                              textLineHeight
                          }
                          dominantBaseline="central"
                        >
                          {line}
                        </text>
                      ))
                    )}
                  </g>
                ) : (
                  <svg
                    width={width}
                    height={height}
                    viewBox="0 0 600 300"
                    fill={clip.fill}
                  >
                    {clip.shape === "ellipse" ? (
                      <ellipse cx="300" cy="150" rx="296" ry="146" />
                    ) : clip.shape === "arrow" ? (
                      <path d="M0 110H420V20L600 150L420 280V190H0Z" />
                    ) : (
                      <rect x="4" y="4" width="592" height="292" rx="24" />
                    )}
                  </svg>
                )}
              </g>
            </g>
          </g>
        </mask>
      </defs>
    </svg>
  );
}
