import {
  type Clip,
  type Transform,
  type TextStyle,
  textFillDefaults,
} from "./model";
import { localDelta, projectDelta } from "./rotation";

export type TextBox = { width: number; height: number };
export const textLineHeight = 1.25;
export function textFill(style?: TextStyle) {
  return {
    color: style?.fill ?? textFillDefaults.fill,
    opacity:
      style?.fillEnabled === false
        ? 0
        : (style?.fillOpacity ?? textFillDefaults.fillOpacity),
  };
}

export function textFillCss(style?: TextStyle) {
  const fill = textFill(style);
  return `${fill.color}${Math.round(fill.opacity * 255)
    .toString(16)
    .padStart(2, "0")}`;
}

// Background spacing is independent of the text frame, font size and fitting.
export function textFillGeometry(style: TextStyle | undefined, frame: TextBox) {
  const paddingX = style?.fillPaddingX ?? textFillDefaults.fillPaddingX;
  const paddingY = style?.fillPaddingY ?? textFillDefaults.fillPaddingY;
  const width = frame.width + paddingX * 2;
  const height = frame.height + paddingY * 2;
  return {
    paddingX,
    paddingY,
    width,
    height,
    radius: Math.min(
      style?.fillRadius ?? textFillDefaults.fillRadius,
      width / 2,
      height / 2,
    ),
  };
}

export function textFrameSize(
  clip: Pick<Clip, "text" | "style" | "textBox">,
  measuredWidth: number,
): TextBox {
  if (clip.textBox) return clip.textBox;
  const padding = (clip.style?.outlineWidth ?? 0) * 2;
  return {
    width: Math.min(32768, Math.max(16, measuredWidth) + padding),
    height: Math.min(
      32768,
      Math.max(
        16,
        (clip.text ?? "").split("\n").length *
          (clip.style?.fontSize ?? 68) *
          textLineHeight +
          padding,
      ),
    ),
  };
}
const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

// Measure at a fixed size so fitting is independent of the current font size.
// The callback lets the renderer use its actual font metrics instead of counting characters.
export function fitTextFont(
  text: string,
  box: TextBox,
  outlineWidth: number,
  measure: (line: string) => number,
): number {
  const lines = text.split("\n");
  const width = Math.max(1, ...lines.map((line) => measure(line || " ")));
  const padding = outlineWidth * 2;
  return clamp(
    Math.min(
      ((box.width - padding) / width) * 100,
      (box.height - padding) / (lines.length * textLineHeight),
    ),
    8,
    300,
  );
}

// Text frames resize independently on each axis. Keep the opposite edge/corner
// anchored, including on a rotated or scaled layer, without changing layer scale.
export function resizeTextBox(
  original: Transform,
  box: TextBox,
  delta: { x: number; y: number },
  handle: { x: number; y: number },
  canvas: TextBox,
  rotation = 0,
): { value: Transform; box: TextBox } {
  const local = localDelta(original, delta, rotation);
  const dx = local.x / original.scale;
  const dy = local.y / original.scale;
  const next = {
    width: clamp(box.width + dx * handle.x, 16, 32768),
    height: clamp(box.height + dy * handle.y, 16, 32768),
  };
  const sx = ((next.width - box.width) * handle.x * original.scale) / 2;
  const sy = ((next.height - box.height) * handle.y * original.scale) / 2;
  const shift = projectDelta(original, { x: sx, y: sy }, rotation);
  return {
    box: next,
    value: {
      ...original,
      x: clamp(original.x + shift.x / canvas.width, -4, 4),
      y: clamp(original.y + shift.y / canvas.height, -4, 4),
    },
  };
}
