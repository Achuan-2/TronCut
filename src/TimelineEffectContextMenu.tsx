import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { editableIds } from "../shared/timeline";
import {
  hasTimelineEffect,
  type TimelineEffectSelection,
} from "../shared/timeline-effect-edit";
import {
  displayShortcut,
  shortcutCommandForEvent,
  type ShortcutMap,
} from "../shared/shortcuts";
import type { Editor } from "./useEditor";

export default function TimelineEffectContextMenu({
  editor,
  menu,
  shortcuts,
  onClose,
}: {
  editor: Editor;
  menu: TimelineEffectSelection & { x: number; y: number };
  shortcuts: ShortcutMap;
  onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const clip = editor.project.clips.find((clip) => clip.id === menu.clipId);
  const exists = !!clip && hasTimelineEffect(clip, menu.id);
  const editable =
    exists && editableIds(editor.project, [menu.clipId]).has(menu.clipId);
  useLayoutEffect(() => {
    root.current?.querySelector("button")?.focus();
  }, []);
  useEffect(() => {
    if (!exists) onClose();
  }, [exists, onClose]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);
  const copy = () => {
    editor.copyTimelineEffect(menu.clipId, menu.id);
    onClose();
  };
  const remove = () => {
    if (editable) editor.removeTimelineEffect(menu.clipId, menu.id);
    onClose();
  };
  const shortcut = (value: string) =>
    displayShortcut(value, navigator.platform);
  if (!exists) return null;
  return createPortal(
    <div
      ref={root}
      role="menu"
      aria-label="效果操作"
      className="context-menu"
      style={{
        left: Math.max(8, Math.min(menu.x, window.innerWidth - 210)),
        top: Math.max(8, Math.min(menu.y, window.innerHeight - 100)),
      }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        event.stopPropagation();
        const command = shortcutCommandForEvent(event.nativeEvent, shortcuts);
        if (command === "copy") {
          event.preventDefault();
          copy();
          return;
        }
        if (command === "delete" || command === "rippleDelete") {
          event.preventDefault();
          remove();
          return;
        }
        if (["Escape", "Tab"].includes(event.key)) {
          event.preventDefault();
          onClose();
          return;
        }
        if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        const buttons = [
          ...root.current!.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ),
        ];
        const current = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const index =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (current +
                  (event.key === "ArrowDown" ? 1 : buttons.length - 1)) %
                buttons.length;
        buttons[index]?.focus();
      }}
    >
      <button role="menuitem" onClick={copy}>
        复制效果
        <span className="menu-shortcut">{shortcut(shortcuts.copy)}</span>
      </button>
      <button role="menuitem" disabled={!editable} onClick={remove}>
        移除效果
        <span className="menu-shortcut">{shortcut(shortcuts.delete)}</span>
      </button>
    </div>,
    document.body,
  );
}
