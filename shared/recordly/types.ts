// Recordly adapter types, AGPL-3.0-only.
export type ZoomDepth = 1 | 2 | 3 | 4 | 5 | 6;
export type ZoomMode = "auto" | "manual";
export interface ZoomFocus { cx: number; cy: number }
export interface ZoomRegion {
  id: string; startMs: number; endMs: number; depth: ZoomDepth;
  focus: ZoomFocus; mode?: ZoomMode;
}
export interface CursorTelemetryPoint {
  timeMs: number; cx: number; cy: number; pressure?: number;
  interactionType?: "move" | "click" | "double-click" | "right-click" | "middle-click" | "mouseup";
  cursorType?: "arrow" | "text" | "pointer" | "crosshair" | "open-hand" | "closed-hand" | "resize-ew" | "resize-ns" | "not-allowed";
}
export const ZOOM_DEPTH_SCALES: Record<ZoomDepth, number> = {
  1: 1.25, 2: 1.5, 3: 1.8, 4: 2.2, 5: 3.5, 6: 5,
};
export function clampFocusToDepth(focus: ZoomFocus, _depth: ZoomDepth): ZoomFocus {
  return { cx: Math.max(0, Math.min(1, focus.cx)), cy: Math.max(0, Math.min(1, focus.cy)) };
}
