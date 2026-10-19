import type { TextStyle } from "./model";

type TextFormat = Pick<TextStyle, "bold" | "italic" | "underline">;

/** Keep legacy defaults identical across preview, measurements and export. */
export function textFormatCss(style?: TextFormat) {
  return {
    fontWeight: style?.bold === false ? 400 : 700,
    fontStyle: style?.italic ? "italic" : "normal",
    textDecoration: style?.underline ? "underline" : "none",
  } as const;
}

export function textCanvasFont(style: TextStyle) {
  const format = textFormatCss(style);
  const family = style.fontFamily.replace(/["\\]/g, "");
  return `${format.fontStyle} ${format.fontWeight} ${style.fontSize}px "${family}", "PingFang SC", sans-serif`;
}

export function textPangoFont(style: TextStyle, resolution = 1) {
  return `${style.fontFamily} ${style.bold === false ? "Normal" : "Bold"}${style.italic ? " Italic" : ""} ${style.fontSize * resolution}`;
}

export function textPangoMarkup(text: string, style: TextFormat) {
  const escaped = text.replace(
    /[&<>"']/g,
    (value) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[value]!,
  );
  return style.underline
    ? `<span underline="single">${escaped}</span>`
    : escaped;
}
