import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";
import {
  arrangeClips,
  canArrangeClips,
  type ArrangeDirection,
} from "../shared/canvas-actions";
import { editableIds } from "../shared/timeline";
import type { Editor } from "./useEditor";
import "./CanvasContextMenu.css";

export type ClipCommand =
  | "cut"
  | "copy"
  | "paste"
  | "duplicate"
  | "delete"
  | "rippleDelete"
  | "group"
  | "ungroup";
export interface ClipMenuPosition {
  x: number;
  y: number;
  clipId: string | null;
}

export default function ClipContextMenu({
  editor,
  menu,
  onClose,
  onCommand,
  portalTarget,
  surface = "canvas",
  children,
}: {
  editor: Editor;
  menu: ClipMenuPosition | null;
  onClose: () => void;
  onCommand: (command: ClipCommand) => void;
  portalTarget: HTMLElement | null;
  surface?: "canvas" | "timeline";
  children?: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const arrangeButton = useRef<HTMLButtonElement>(null);
  const submenuRoot = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [submenu, setSubmenu] = useState<{ x: number; y: number } | null>(null);
  const { project } = editor;
  const projectId = useRef(project.id);
  const source = menu?.clipId
    ? project.clips.find((clip) => clip.id === menu.clipId)
    : undefined;
  const ids = source ? editor.selectedIds : [];
  const editable = source ? editableIds(project, ids) : new Set<string>();
  const canEdit = ids.length > 0 && ids.every((id) => editable.has(id));
  const selected = source
    ? project.clips.filter((clip) => ids.includes(clip.id))
    : [];
  const canGroup =
    canEdit &&
    selected.length > 1 &&
    (!selected[0].groupId ||
      selected.some((clip) => clip.groupId !== selected[0].groupId));
  const canUngroup = canEdit && selected.some((clip) => !!clip.groupId);
  const canFit = canEdit && selected.some((clip) => clip.kind !== "audio");
  useEffect(() => {
    if (projectId.current !== project.id) {
      projectId.current = project.id;
      onClose();
    }
  }, [project.id, onClose]);
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
  const command = (name: ClipCommand) => {
    onClose();
    onCommand(name);
  };
  const arrange = (direction: ArrangeDirection) => {
    editor.apply((project) => arrangeClips(project, ids, direction));
    onClose();
  };
  const fit = () => {
    editor.fitClipsToCanvas(ids);
    onClose();
  };
  if (!menu) return null;
  const item = (
    label: string,
    name: ClipCommand,
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
      aria-label={surface === "canvas" ? "画布对象操作" : "时间轴对象操作"}
      className={`context-menu canvas-context-menu ${surface === "timeline" ? "timeline-context-menu" : ""}`}
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
            "button:not(:disabled)",
          ) ?? [],
        ).filter((button) => button.closest('[role="menu"]') === container);
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
      {surface === "timeline" &&
        item("波纹删除", "rippleDelete", "Shift+Delete")}
      <hr />
      <button
        role="menuitem"
        disabled={!source}
        onPointerEnter={() => setSubmenu(null)}
        onClick={() => {
          if (source) {
            editor.copyClipProperties(source.id);
          }
          onClose();
        }}
      >
        复制属性
      </button>
      <button
        role="menuitem"
        disabled={!canEdit || !editor.hasClipProperties}
        onPointerEnter={() => setSubmenu(null)}
        onClick={() => {
          editor.pasteClipProperties(ids);
          onClose();
        }}
      >
        粘贴属性
      </button>
      <hr />
      <button
        role="menuitem"
        disabled={!canFit}
        onPointerEnter={() => setSubmenu(null)}
        onClick={fit}
      >
        自适应缩放
      </button>
      {surface === "timeline" && (
        <>
          <hr />
          {item("组合", "group", "", !canGroup)}
          {item("取消组合", "ungroup", "", !canUngroup)}
        </>
      )}
      {children && (
        <div className="clip-context-extras" onClick={onClose}>
          {children}
        </div>
      )}
      {surface === "canvas" && (
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
      )}
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
