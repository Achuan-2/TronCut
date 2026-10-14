import type { Transform } from "./model";
import { localDelta, projectDelta } from "./rotation";

export type TextBox = { width: number; height: number };
export const textLineHeight = 1.25;
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
