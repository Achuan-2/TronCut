import { useMemo } from "react";
import type { Clip } from "../shared/model";
import {
  clipsBehaviorText,
  glyphMotion,
  layoutGlyphs,
} from "../shared/behaviors";
import { textFrameSize } from "../shared/text";

export default function BehaviorText({
  clip,
  time,
  scale,
}: {
  clip: Clip;
  time: number;
  scale: number;
}) {
  const fontSize = clip.style?.fontSize ?? 68;
  const layout = useMemo(() => {
    const context = document.createElement("canvas").getContext("2d")!;
    context.font = `700 ${fontSize}px "${(clip.style?.fontFamily ?? "Microsoft YaHei").replace(/["\\]/g, "")}", "PingFang SC", sans-serif`;
    return layoutGlyphs(
      clip.text ?? "",
      fontSize,
      (text) => context.measureText(text).width,
    );
  }, [clip.text, clip.style?.fontFamily, fontSize]);
  const box = textFrameSize(clip, layout.width);
  return (
    <span
      className="behavior-text-layout"
      style={{
        width: layout.width * scale,
        height: layout.height * scale,
        clipPath: clipsBehaviorText(clip, time, layout.count)
          ? `inset(${((layout.height - box.height) * scale) / 2}px ${((layout.width - box.width) * scale) / 2}px)`
          : undefined,
      }}
    >
      {layout.glyphs.map((glyph) => {
        const motion = glyphMotion(
          clip,
          time,
          glyph.index,
          layout.count,
          "text",
        );
        return (
          <span
            key={glyph.index}
            style={{
              position: "absolute",
              left: (glyph.x + motion.x * fontSize) * scale,
              top: (glyph.y + motion.y * fontSize) * scale,
              opacity: motion.opacity,
              transform: `translate(-50%, -50%) rotateZ(${motion.rotation}deg) rotateY(${motion.rotationY}deg) rotateX(${motion.rotationX}deg) scale(${motion.scale})`,
            }}
          >
            {glyph.text}
          </span>
        );
      })}
    </span>
  );
}
