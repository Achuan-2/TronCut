import { useMemo } from "react";
import type { Clip } from "../shared/model";
import { textFormatCss } from "../shared/text-format";
import { clipsBehaviorText, glyphMotion } from "../shared/behaviors";
import { styledTextLayout, textBoxFor } from "./text";

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
    return styledTextLayout(clip);
  }, [clip.text, clip.textRuns, clip.style]);
  const box = textBoxFor(clip);
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
              ...textFormatCss(glyph.style),
              fontFamily: `"${glyph.style.fontFamily.replace(/["\\]/g, "")}", "PingFang SC", sans-serif`,
              fontSize: glyph.style.fontSize * scale,
              color: glyph.style.color,
              WebkitTextStroke: `${glyph.style.outlineWidth * scale}px ${glyph.style.outline}`,
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
