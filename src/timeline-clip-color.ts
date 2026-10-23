import type { CSSProperties } from "react";
import { timelineClipTextColor } from "../shared/timeline-clip-color";

export function timelineClipColorStyle(color?: string): CSSProperties {
  if (!color) return {};
  const foreground = timelineClipTextColor(color);
  return {
    backgroundColor: color,
    color: foreground,
    "--clip-color": color,
    "--clip-color-text": foreground,
  } as CSSProperties;
}
