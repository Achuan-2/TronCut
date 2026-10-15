import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "./useEditor";

export default function BehaviorContextMenu({ editor }: { editor: Editor }) {
  const root = useRef<HTMLDivElement>(null),
    menu = editor.behaviorMenu;
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node))
        editor.showBehaviorMenu(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        editor.showBehaviorMenu(null);
      }
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape, true);
    };
  }, [menu, editor.showBehaviorMenu]);
  if (!menu) return null;
  return createPortal(
    <div
      ref={root}
      className="context-menu"
      role="menu"
      style={{
        left: Math.min(menu.x, window.innerWidth - 200),
        top: Math.min(menu.y, window.innerHeight - 140),
      }}
      onClick={() => editor.showBehaviorMenu(null)}
    >
      <button
        role="menuitem"
        onClick={() => editor.copyBehavior(menu.clipId, menu.behaviorId)}
      >
        复制效果
      </button>
      <button
        role="menuitem"
        disabled={menu.locked || !editor.hasBehaviorClipboard()}
        onClick={() => editor.pasteBehavior(menu.clipId)}
      >
        粘贴效果
      </button>
      <button
        role="menuitem"
        disabled={menu.locked}
        onClick={() => editor.removeBehavior(menu.clipId, menu.behaviorId)}
      >
        删除行为<span className="menu-shortcut">Delete</span>
      </button>
    </div>,
    document.body,
  );
}
