import type { Asset, Clip } from "./model";
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

export function cursorSvg(style: NonNullable<Clip["cursorStyle"]>): string {
  const shape =
    style.style === "circle"
      ? '<circle cx="16" cy="16" r="12"/>'
      : style.style === "cross"
        ? `<path d="M16 2V30M2 16H30" fill="none" stroke="${style.color}" stroke-width="3"/>`
        : '<path d="M3 2L3 27L10 20L16 31L21 28L15 17L26 17Z"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><g fill="${style.color}" stroke="#111111" stroke-width="2" stroke-linejoin="round">${shape}</g></svg>`;
}
