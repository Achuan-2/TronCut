import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import { reorderTrack } from "../shared/tracks";
import type { Project } from "../shared/model";
import type { Editor } from "./useEditor";

interface Target {
  id: string;
  side: "above" | "below";
}
interface Gesture {
  id: string;
  pointerId: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  element: HTMLElement;
  project: Project;
  target: Target | null;
}

/** Preview only an insertion line; commit one undoable order change on release. */
export function useTrackReorder(
  editor: Editor,
  headers: RefObject<HTMLDivElement | null>,
  closeMenus: () => void,
) {
  const gesture = useRef<Gesture | null>(null);
  const animation = useRef<number | null>(null);
  const ignoreClick = useRef(false);
  const [preview, setPreview] = useState<{
    id: string;
    target: Target | null;
  } | null>(null);
  const latest = useRef({ editor, closeMenus });
  latest.current = { editor, closeMenus };

  const cancel = useCallback(() => {
    const drag = gesture.current;
    gesture.current = null;
    if (animation.current !== null) cancelAnimationFrame(animation.current);
    animation.current = null;
    if (drag?.element.hasPointerCapture(drag.pointerId))
      drag.element.releasePointerCapture(drag.pointerId);
    setPreview(null);
  }, []);

  const updateTarget = useCallback(() => {
    const drag = gesture.current;
    const container = headers.current;
    if (!drag?.active || !container) return;
    const bounds = container.getBoundingClientRect();
    const body = container.closest(".timeline-body")!.getBoundingClientRect();
    // The sticky toolbar is 36px high and is not a track drop target.
    const top = bounds.top + 36;
    const inside =
      drag.x >= body.left &&
      drag.x <= body.right &&
      drag.y >= top &&
      drag.y <= bounds.bottom;
    const rows = Array.from(
      container.querySelectorAll<HTMLElement>(".track-header[data-track-id]"),
    );
    let target: Target | null = null;
    if (inside && rows.length) {
      const row = rows.find((row) => {
        const rect = row.getBoundingClientRect();
        return drag.y < rect.top + rect.height / 2;
      });
      const id = (row ?? rows.at(-1)!).dataset.trackId!;
      if (id !== drag.id) target = { id, side: row ? "above" : "below" };
    }
    drag.target = target;
    setPreview((previous) =>
      previous?.id === drag.id &&
      previous.target?.id === target?.id &&
      previous.target?.side === target?.side
        ? previous
        : { id: drag.id, target },
    );
  }, [headers]);

  const tick = useCallback(
    function tick() {
      const drag = gesture.current;
      const container = headers.current;
      if (!drag?.active || !container) return;
      const bounds = container.getBoundingClientRect();
      const top = bounds.top + 36;
      const speed =
        drag.y < top + 28
          ? -Math.min(18, (top + 28 - drag.y) / 3)
          : drag.y > bounds.bottom - 28
            ? Math.min(18, (drag.y - bounds.bottom + 28) / 3)
            : 0;
      if (speed) container.scrollTop += speed;
      updateTarget();
      animation.current = requestAnimationFrame(tick);
    },
    [headers, updateTarget],
  );

  useEffect(() => {
    cancel();
  }, [editor.project, editor.activeGroupId, cancel]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!gesture.current || event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", cancel);
      const drag = gesture.current;
      gesture.current = null;
      if (animation.current !== null) cancelAnimationFrame(animation.current);
      if (drag?.element.hasPointerCapture(drag.pointerId))
        drag.element.releasePointerCapture(drag.pointerId);
    };
  }, [cancel]);

  const begin = (event: PointerEvent<HTMLDivElement>, id: string) => {
    if (event.button !== 0 || !event.isPrimary) return;
    ignoreClick.current = false;
    if (
      (event.target as HTMLElement).closest(
        "button, input, select, textarea, [contenteditable], [role='separator']",
      )
    )
      return;
    event.stopPropagation();
    gesture.current = {
      id,
      pointerId: event.pointerId,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      active: false,
      element: event.currentTarget,
      project: latest.current.editor.project,
      target: null,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const drag = gesture.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (!drag.active && Math.abs(drag.y - drag.startY) >= 4) {
      drag.active = true;
      ignoreClick.current = true;
      latest.current.closeMenus();
      animation.current = requestAnimationFrame(tick);
    }
    if (drag.active) {
      event.preventDefault();
      updateTarget();
    }
  };
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const drag = gesture.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.x = event.clientX;
    drag.y = event.clientY;
    updateTarget();
    const target = drag.target;
    cancel();
    if (drag.active && target && latest.current.editor.project === drag.project)
      latest.current.editor.apply((project) =>
        reorderTrack(project, drag.id, target.id, target.side),
      );
  };
  const suppressClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!ignoreClick.current) return;
    ignoreClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  };
  return {
    cancel,
    active: !!preview,
    className: (id: string) =>
      [
        preview?.id === id ? "track-reorder-source" : "",
        preview?.target?.id === id ? `track-drop-${preview.target.side}` : "",
      ]
        .filter(Boolean)
        .join(" "),
    headerProps: (id: string) => ({
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => begin(event, id),
      onPointerMove: move,
      onPointerUp: finish,
      onPointerCancel: cancel,
      onLostPointerCapture: cancel,
      onClickCapture: suppressClick,
    }),
  };
}
