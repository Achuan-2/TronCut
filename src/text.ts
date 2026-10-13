import type { Clip } from "../shared/model";
import { fitTextFont, textLineHeight, type TextBox } from "../shared/text";

let context: CanvasRenderingContext2D | null;
function textMeasure(clip: Clip, fontSize: number) {
  context ??= document.createElement("canvas").getContext("2d");
  if (!context) throw new Error("无法测量文字尺寸");
  context.font = `700 ${fontSize}px "${(clip.style?.fontFamily ?? "Microsoft YaHei").replace(/["\\]/g, "")}", "PingFang SC", sans-serif`;
  return (line: string) => context!.measureText(line).width;
}

export function textBoxFor(clip: Clip): TextBox {
  if (clip.textBox) return clip.textBox;
  const fontSize = clip.style?.fontSize ?? 68;
  const measure = textMeasure(clip, fontSize);
  const lines = (clip.text ?? "").split("\n");
  const padding = (clip.style?.outlineWidth ?? 0) * 2;
  return {
    width: Math.min(
      32768,
      Math.max(16, ...lines.map((line) => measure(line || " "))) + padding,
    ),
    height: Math.min(
      32768,
      Math.max(16, lines.length * fontSize * textLineHeight + padding),
    ),
  };
}

export function fittedTextFont(clip: Clip, box: TextBox): number {
  return fitTextFont(
    clip.text ?? "",
    box,
    clip.style?.outlineWidth ?? 0,
    textMeasure(clip, 100),
  );
}

// All text edits (canvas, inspector, preset) use the same fitting rule.
export function fitUpdatedText(before: Clip, next: Clip): Clip {
  if (next.kind !== "text" || !next.autoResizeText || !next.style) return next;
  if (
    before.autoResizeText === next.autoResizeText &&
    before.text === next.text &&
    before.textBox === next.textBox &&
    before.style?.fontFamily === next.style.fontFamily &&
    before.style?.fontSize === next.style.fontSize &&
    before.style?.outlineWidth === next.style.outlineWidth
  )
    return next;
  const textBox = next.textBox ?? textBoxFor(before);
  return {
    ...next,
    textBox,
    style: { ...next.style, fontSize: fittedTextFont(next, textBox) },
  };
}
