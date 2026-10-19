import type { Clip, TextStyle } from "../shared/model";
import { fitTextFont, textFrameSize, type TextBox } from "../shared/text";
import { layoutStyledText } from "../shared/rich-text";
import { textCanvasFont } from "../shared/text-format";

let context: CanvasRenderingContext2D | null;
export function measureStyledText(text: string, style: TextStyle) {
  context ??= document.createElement("canvas").getContext("2d");
  if (!context) throw new Error("无法测量文字尺寸");
  context.font = textCanvasFont(style);
  return context.measureText(text).width;
}
export const styledTextLayout = (clip: Clip) =>
  layoutStyledText(clip, measureStyledText);
function textMeasure(clip: Clip, fontSize: number) {
  context ??= document.createElement("canvas").getContext("2d");
  if (!context) throw new Error("无法测量文字尺寸");
  context.font = textCanvasFont({ ...clip.style!, fontSize });
  return (line: string) => context!.measureText(line).width;
}

export function textBoxFor(clip: Clip): TextBox {
  if (clip.textBox) return clip.textBox;
  if (clip.textRuns?.length) {
    const layout = styledTextLayout(clip);
    const padding =
      Math.max(
        clip.style?.outlineWidth ?? 0,
        ...clip.textRuns.map((run) => run.style.outlineWidth ?? 0),
      ) * 2;
    return {
      width: Math.min(32768, layout.width + padding),
      height: Math.min(32768, layout.height + padding),
    };
  }
  const fontSize = clip.style?.fontSize ?? 68;
  const measure = textMeasure(clip, fontSize);
  const lines = (clip.text ?? "").split("\n");
  return textFrameSize(
    clip,
    Math.max(...lines.map((line) => measure(line || " "))),
  );
}

export function fittedTextFont(clip: Clip, box: TextBox): number {
  if (clip.textRuns?.length) {
    const layout = styledTextLayout(clip);
    const padding =
      Math.max(
        clip.style?.outlineWidth ?? 0,
        ...clip.textRuns.map((run) => run.style.outlineWidth ?? 0),
      ) * 2;
    return Math.max(
      8,
      Math.min(
        300,
        (clip.style?.fontSize ?? 68) *
          Math.min(
            (box.width - padding) / layout.width,
            (box.height - padding) / layout.height,
          ),
      ),
    );
  }
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
    before.textRuns === next.textRuns &&
    before.textBox === next.textBox &&
    before.style?.fontFamily === next.style.fontFamily &&
    before.style?.fontSize === next.style.fontSize &&
    before.style?.bold === next.style.bold &&
    before.style?.italic === next.style.italic &&
    before.style?.outlineWidth === next.style.outlineWidth
  )
    return next;
  const textBox = next.textBox ?? textBoxFor(before);
  const fontSize = fittedTextFont(next, textBox);
  const ratio = fontSize / next.style.fontSize;
  return {
    ...next,
    textBox,
    style: { ...next.style, fontSize },
    textRuns: next.textRuns?.map((run) => ({
      ...run,
      style: {
        ...run.style,
        ...(run.style.fontSize === undefined
          ? {}
          : {
              fontSize: Math.max(8, Math.min(300, run.style.fontSize * ratio)),
            }),
      },
    })),
  };
}
