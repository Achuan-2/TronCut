import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";
import type { Clip } from "../shared/model";
import {
  arrangeClips,
  canArrangeClips,
  editableCanvasIds,
  fitFrameTransform,
  pasteClipProperties,
  type ArrangeDirection,
} from "../shared/canvas-actions";
import { editableIds } from "../shared/timeline";
import { setTransform, transformAt } from "../shared/editor";
import { defaultCrop } from "../shared/effects";
import { visualClipAt } from "../shared/visual-state";
import { textBoxFor } from "./text";
import type { Editor } from "./useEditor";
import "./CanvasContextMenu.css";

export type CanvasCommand = "cut" | "copy" | "paste" | "duplicate" | "delete";
export interface CanvasMenuPosition {
  x: number;
  y: number;
  clipId: string | null;
}

export default function CanvasContextMenu({
  editor,
  menu,
  onClose,
  onCommand,
  portalTarget,
}: {
  editor: Editor;
  menu: CanvasMenuPosition | null;
  onClose: () => void;
  onCommand: (command: CanvasCommand) => void;
  portalTarget: HTMLElement | null;
}) {
  const root = useRef<HTMLDivElement>(null);
  const arrangeButton = useRef<HTMLButtonElement>(null);
  const submenuRoot = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [submenu, setSubmenu] = useState<{ x: number; y: number } | null>(null);
  const [properties, setProperties] = useState<Clip | null>(null);
  const { project } = editor;
  const source = menu?.clipId
    ? project.clips.find((clip) => clip.id === menu.clipId)
    : undefined;
  const ids = source ? editor.selectedIds : [];
  const editable = source ? editableIds(project, ids) : new Set<string>();
  const canEdit = ids.length > 0 && ids.every((id) => editable.has(id));
  useEffect(() => {
    setProperties(null);
    onClose();
  }, [project.id]);
  useLayoutEffect(() => {
    setSubmenu(null);
    if (!menu) return;
    const bounds = root.current?.getBoundingClientRect();
    setPosition({
      x: Math.max(
        8,
        Math.min(menu.x, window.innerWidth - (bounds?.width ?? 240) - 8),
      ),
      y: Math.max(
        8,
        Math.min(menu.y, window.innerHeight - (bounds?.height ?? 400) - 8),
      ),
    });
    root.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) onClose();
    };
    const close = () => onClose();
    window.addEventListener("pointerdown", outside);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [menu, onClose]);
  const openSubmenu = (focus = false) => {
    const bounds = arrangeButton.current?.getBoundingClientRect();
    if (!bounds || !canEdit) return;
    setSubmenu({
      x:
        bounds.right + 180 < window.innerWidth
          ? bounds.right
          : bounds.left - 180,
      y: Math.max(8, Math.min(bounds.top, window.innerHeight - 180)),
    });
    if (focus)
      requestAnimationFrame(() =>
        submenuRoot.current
          ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
          ?.focus(),
      );
  };
  const command = (name: CanvasCommand) => {
    onClose();
    onCommand(name);
  };
  const arrange = (direction: ArrangeDirection) => {
    editor.apply((project) => arrangeClips(project, ids, direction));
    onClose();
  };
  const fit = () => {
    const targets = editableCanvasIds(project, ids);
    // Apply as one undoable operation to every selected, editable object.
    editor.apply((project) => ({
      ...project,
      clips: project.clips.map((clip) => {
        if (!targets.has(clip.id) || clip.kind === "audio") return clip;
        const value = transformAt(clip, editor.playhead - clip.start);
        const sampled = visualClipAt(clip, value);
        const asset = project.assets.find((asset) => asset.id === clip.assetId);
        const ratio = asset
          ? Math.min(
              project.canvas.width / Math.max(1, asset.width),
              project.canvas.height / Math.max(1, asset.height),
            )
          : 1;
        const crop = sampled.crop ?? defaultCrop;
        const size =
          clip.kind === "text"
            ? textBoxFor(clip)
            : asset
              ? {
                  width: asset.width * ratio * (1 - crop.left - crop.right),
                  height: asset.height * ratio * (1 - crop.top - crop.bottom),
                }
              : { width: 600, height: 300 };
        return setTransform(
          clip,
          fitFrameTransform(value, size, project.canvas, clip.rotation),
          editor.playhead - clip.start,
          editor.autoAnimate,
          editor.preferences.timing.animation,
        );
      }),
    }));
    onClose();
  };
  if (!menu) return null;
  const item = (
    label: string,
    name: CanvasCommand,
    shortcut: string,
    disabled = !canEdit,
  ) => (
    <button
      role="menuitem"
      aria-label={label}
      disabled={disabled}
      onPointerEnter={() => setSubmenu(null)}
      onClick={() => command(name)}
    >
      {label}
      <span className="menu-shortcut">{shortcut}</span>
    </button>
  );
  return createPortal(
    <div
      ref={root}
      role="menu"
      aria-label="画布对象操作"
      className="context-menu canvas-context-menu"
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" || event.key === "Tab") {
          event.preventDefault();
          onClose();
          return;
        }
        if (
          event.key === "ArrowRight" &&
          document.activeElement === arrangeButton.current
        ) {
          event.preventDefault();
          openSubmenu(true);
          return;
        }
        if (event.key === "ArrowLeft" && submenu) {
          event.preventDefault();
          setSubmenu(null);
          arrangeButton.current?.focus();
          return;
        }
        if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        const container = submenuRoot.current?.contains(event.target as Node)
          ? submenuRoot.current
          : root.current;
        const buttons = Array.from(
          container?.querySelectorAll<HTMLButtonElement>(
            ":scope > button:not(:disabled)",
          ) ?? [],
        );
        const current = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (current +
                  (event.key === "ArrowDown" ? 1 : buttons.length - 1)) %
                buttons.length;
        buttons[next]?.focus();
      }}
    >
      {item("剪切", "cut", "Ctrl+X")}
      {item("复制", "copy", "Ctrl+C", !source)}
      {item("粘贴", "paste", "Ctrl+V", false)}
      {item("拷贝", "duplicate", "Ctrl+D")}
      {item("删除", "delete", "Delete")}
      <hr />
      <button
        role="menuitem"
        disabled={!source}
        onPointerEnter={() => setSubmenu(null)}
        onClick={() => {
          if (source) {
            const value = transformAt(source, editor.playhead - source.start);
            setProperties(
              structuredClone({
                ...visualClipAt(source, value),
                transform: value,
              }),
            );
          }
          onClose();
        }}
      >
        复制属性
      </button>
      <button
        role="menuitem"
        disabled={!canEdit || !properties}
        onPointerEnter={() => setSubmenu(null)}
        onClick={() => {
          if (properties)
            editor.apply((project) =>
              pasteClipProperties(project, ids, properties),
            );
          onClose();
        }}
      >
        粘贴属性
      </button>
      <hr />
      <button
        role="menuitem"
        disabled={!canEdit}
        onPointerEnter={() => setSubmenu(null)}
        onClick={fit}
      >
        自适应缩放
      </button>
      <button
        ref={arrangeButton}
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={!!submenu}
        disabled={!canEdit}
        onPointerEnter={() => openSubmenu()}
        onClick={() => openSubmenu(true)}
      >
        排列
        <ChevronRight size={14} className="canvas-menu-arrow" />
      </button>
      {submenu && (
        <div
          ref={submenuRoot}
          role="menu"
          aria-label="排列"
          className="context-menu canvas-context-submenu"
          style={{ left: submenu.x, top: submenu.y }}
        >
          {(
            [
              ["top", "置于顶层"],
              ["up", "上移一层"],
              ["down", "下移一层"],
              ["bottom", "置于底层"],
            ] as const
          ).map(([direction, label]) => (
            <button
              key={direction}
              role="menuitem"
              disabled={!canArrangeClips(project, ids, direction)}
              onClick={() => arrange(direction)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>,
    portalTarget ?? document.body,
  );
}
