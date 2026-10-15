import { useEffect, useRef, type RefObject } from "react";

export interface ZoomPoint {
  x: number;
  y: number;
}

let activePanel: HTMLElement | null = null;
let hoveredPanel: HTMLElement | null = null;
const editable =
  'input:not([type="range"]), textarea, [contenteditable="true"]';

/** Route zoom shortcuts to the hovered panel, falling back to the last used one. */
export function useViewportZoom(
  ref: RefObject<HTMLElement | null>,
  zoom: (factor: number, point?: ZoomPoint) => void,
  enabled = true,
) {
  const callback = useRef(zoom);
  callback.current = zoom;
  useEffect(() => {
    const panel = ref.current;
    if (!panel || !enabled) return;
    panel.dataset.zoomPanel = "true";
    const enter = () => {
      hoveredPanel = panel;
    };
    const leave = () => {
      if (hoveredPanel === panel) hoveredPanel = null;
    };
    const activate = () => {
      activePanel = panel;
    };
    const blocked = (target: EventTarget | null) =>
      target instanceof Element && !!target.closest(editable);
    const keydown = (event: KeyboardEvent) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        blocked(event.target) ||
        document.querySelector(
          'dialog[open], [role="dialog"][aria-modal="true"]',
        )
      )
        return;
      const targetPanel = hoveredPanel ?? activePanel;
      if (targetPanel !== panel) return;
      const direction = ["+", "="].includes(event.key)
        ? 1
        : ["-", "_"].includes(event.key)
          ? -1
          : 0;
      if (!direction) return;
      event.preventDefault();
      event.stopPropagation();
      activePanel = panel;
      callback.current(1.3 ** direction);
    };
    const wheel = (event: WheelEvent) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        blocked(event.target) ||
        !event.deltaY
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      activePanel = panel;
      const delta =
        event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? panel.clientHeight
            : 1);
      callback.current(1.3 ** -Math.max(-1, Math.min(1, delta / 100)), {
        x: event.clientX,
        y: event.clientY,
      });
    };
    panel.addEventListener("pointerenter", enter);
    panel.addEventListener("pointerleave", leave);
    panel.addEventListener("pointerdown", activate, true);
    panel.addEventListener("focusin", activate);
    // React's wheel handler is passive; use a native listener to prevent page zoom.
    panel.addEventListener("wheel", wheel, { passive: false });
    document.addEventListener("keydown", keydown, true);
    return () => {
      panel.removeAttribute("data-zoom-panel");
      if (activePanel === panel) activePanel = null;
      leave();
      panel.removeEventListener("pointerenter", enter);
      panel.removeEventListener("pointerleave", leave);
      panel.removeEventListener("pointerdown", activate, true);
      panel.removeEventListener("focusin", activate);
      panel.removeEventListener("wheel", wheel);
      document.removeEventListener("keydown", keydown, true);
    };
  }, [ref, enabled]);
}
