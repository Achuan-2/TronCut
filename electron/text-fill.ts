import type { Clip } from "../shared/model";
import { textFill, textFillGeometry, type TextBox } from "../shared/text";

// The raster texture includes transparent margins for strokes and motion.
// Fill the padded text frame, centered inside that larger texture.
export function textFillRectangle(
  clip: Clip,
  box: TextBox,
  texture: TextBox,
): string {
  const fill = textFill(clip.style);
  if (fill.opacity <= 0) return "";
  const background = textFillGeometry(clip.style, box);
  return `<rect x="${(texture.width - background.width) / 2}" y="${(texture.height - background.height) / 2}" width="${background.width}" height="${background.height}" rx="${background.radius}" fill="${fill.color}" fill-opacity="${fill.opacity}"/>`;
}
