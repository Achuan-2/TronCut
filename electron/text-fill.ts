import type { Clip } from "../shared/model";
import { textFill, type TextBox } from "../shared/text";

// The raster texture includes transparent margins for strokes and motion.
// Fill only the actual text frame, centered inside that larger texture.
export function textFillRectangle(
  clip: Clip,
  box: TextBox,
  texture: TextBox,
): string {
  const fill = textFill(clip.style);
  if (fill.opacity <= 0) return "";
  return `<rect x="${(texture.width - box.width) / 2}" y="${(texture.height - box.height) / 2}" width="${box.width}" height="${box.height}" fill="${fill.color}" fill-opacity="${fill.opacity}"/>`;
}
