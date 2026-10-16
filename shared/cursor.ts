import type { Asset, Clip } from "./model";
import artwork from "./recordly/cursor-artwork.json";
export const cursorShapes = [
  "arrow",
  "text",
  "pointer",
  "crosshair",
  "open-hand",
  "closed-hand",
  "resize-ew",
  "resize-ns",
  "not-allowed",
] as const;
export type CursorShape = (typeof cursorShapes)[number];
export function cursorType(value: unknown): CursorShape {
  return cursorShapes.includes(value as CursorShape)
    ? (value as CursorShape)
    : "arrow";
}
function cursorArtwork(style: string, shape: CursorShape = "arrow") {
  const pack = style === "tahoe-inverted" ? "tahoe" : style;
  const key = `${pack}:${shape}`;
  if (key in artwork) return artwork[key as keyof typeof artwork];
  return pack in artwork ? artwork[pack as keyof typeof artwork] : undefined;
}
export const cursorStyles = {
  macos: "macOS",
  tahoe: "Tahoe",
  "tahoe-inverted": "Tahoe 反色",
  windows11: "Windows 11",
  figma: "Figma",
  dot: "圆点",
  arrow: "箭头",
  circle: "圆形",
  cross: "十字",
  hidden: "隐藏鼠标",
} as const;
/** Artwork hotspots match Recordly's normalized SVG anchors. */
export function cursorAnchor(
  style: NonNullable<Clip["cursorStyle"]>["style"],
  shape: CursorShape = "arrow",
) {
  const art = cursorArtwork(style, shape);
  if (art) return art.anchor;
  switch (style) {
    case "macos":
      return { x: 0.34, y: 0.24 };
    case "tahoe":
    case "tahoe-inverted":
      return { x: 0.14, y: 0.06 };
    case "windows11":
      return { x: 0.31, y: 0.22 };
    case "figma":
      return { x: 40 / 396, y: 22 / 433 };
    case "arrow":
      return { x: 0.09, y: 0.06 };
    default:
      return { x: 0.5, y: 0.5 };
  }
}
export function cursorAspect(
  style: NonNullable<Clip["cursorStyle"]>["style"],
  shape: CursorShape = "arrow",
) {
  return cursorArtwork(style, shape)?.aspect ?? 1;
}
export const defaultCursorStyle = {
  style: "arrow" as const,
  size: 32,
  color: "#ffffff",
  clicks: true,
  smooth: true,
};
export type CursorSample = NonNullable<Asset["cursor"]>["samples"][number];
export type CursorPosition = CursorSample & {
  clickX?: number;
  clickY?: number;
};

/** Binary search keeps cursor lookup independent of recording length. Coordinates are source-normalized. */
export function cursorAt(
  asset: Asset,
  clip: Clip,
  sourceTime: number,
): CursorPosition | null {
  const samples = asset.cursor?.samples;
  if (
    !samples?.length ||
    (clip.cursorStyle ?? defaultCursorStyle).style === "hidden"
  )
    return null;
  let lo = 0,
    hi = samples.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (samples[mid].time <= sourceTime) lo = mid + 1;
    else hi = mid;
  }
  const previous = samples[Math.max(0, lo - 1)],
    next = samples[lo];
  if (
    !previous.visible ||
    previous.time > sourceTime ||
    previous.x < 0 ||
    previous.x > 1 ||
    previous.y < 0 ||
    previous.y > 1
  )
    return null;
  let p =
    next && next.visible && next.time > previous.time
      ? Math.max(
          0,
          Math.min(
            1,
            (sourceTime - previous.time) / (next.time - previous.time),
          ),
        )
      : 0;
  if ((clip.cursorStyle ?? defaultCursorStyle).smooth) p = p * p * (3 - 2 * p);
  let click = false;
  let clickX: number | undefined, clickY: number | undefined;
  for (let i = lo - 1; i >= 0 && samples[i].time >= sourceTime - 0.25; i--) {
    if (samples[i].click) {
      click = true;
      clickX = samples[i].x;
      clickY = samples[i].y;
      break;
    }
  }
  return {
    ...previous,
    time: sourceTime,
    x: previous.x + ((next?.x ?? previous.x) - previous.x) * p,
    y: previous.y + ((next?.y ?? previous.y) - previous.y) * p,
    click,
    clickX,
    clickY,
  };
}

export function cursorSvg(
  style: NonNullable<Clip["cursorStyle"]>,
  shape: CursorShape = "arrow",
): string {
  const art = cursorArtwork(style.style, shape);
  if (art) {
    const svg = art.svg;
    if (style.style !== "tahoe-inverted") return svg;
    return svg
      .replace(
        ">",
        '><defs><filter id="troncut-invert" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="-1 0 0 0 1 0 -1 0 0 1 0 0 -1 0 1 0 0 0 1 0"/></filter></defs><g filter="url(#troncut-invert)">',
      )
      .replace(/<\/svg>$/, "</g></svg>");
  }
  const glyph =
    style.style === "circle" || style.style === "dot"
      ? '<circle cx="16" cy="16" r="12"/>'
      : style.style === "cross"
        ? `<path d="M16 2V30M2 16H30" fill="none" stroke="${style.color}" stroke-width="3"/>`
        : '<path d="M3 2L3 27L10 20L16 31L21 28L15 17L26 17Z"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><g fill="${style.color}" stroke="#111111" stroke-width="2" stroke-linejoin="round">${glyph}</g></svg>`;
}
