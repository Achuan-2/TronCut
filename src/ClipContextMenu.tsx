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
import { detachableVideos } from "../shared/detach-audio";
import type { Editor } from "./useEditor";
import { stitchSelectionError } from "../shared/stitch";
import { stitchBoundaries } from "../shared/media-segments";
import "./CanvasContextMenu.css";
import { groupMembers, rootGroupId } from "../shared/clip-groups";
import { canvasAlignmentTargets } from "../shared/canvas-alignment";
import {
  frameExtensionAt,
  frameExtensionError,
  setFrameExtension,
} from "../shared/frame-extension";

const alignments = [
  ["left", "左对齐"],
  ["center", "水平居中"],
  ["right", "右对齐"],
  ["top", "顶端对齐"],
  ["middle", "垂直居中"],
  ["bottom", "底端对齐"],
] as const;
type SubmenuKind = "arrange" | "align";

export type ClipCommand =
  | "cut"
  | "copy"
  | "paste"
  | "duplicate"
  | "delete"
  | "rippleDelete"
  | "stitch"
  | "unstitch"
  | "detachAudio"
  | "group"
  | "ungroup";
export interface ClipMenuPosition {
  x: number;
  y: number;
  clipId: string | null;
  stitchTime?: number;
  frameExtensionTime?: number;
}

export default function ClipContextMenu({
  editor,
  menu,
  onClose,
  onCommand,
  onRename,
  onExtendFrame,
  portalTarget,
  surface = "canvas",
  children,
}: {
  editor: Editor;
  menu: ClipMenuPosition | null;
  onClose: () => void;
  onCommand: (command: ClipCommand) => void;
  onRename?: (id: string) => void;
  onExtendFrame?: (id: string, local: number) => void;
  portalTarget: HTMLElement | null;
  surface?: "canvas" | "timeline";
  children?: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const arrangeButton = useRef<HTMLButtonElement>(null);
  const alignButton = useRef<HTMLButtonElement>(null);
  const submenuRoot = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [submenu, setSubmenu] = useState<{
    kind: SubmenuKind;
    x: number;
    y: number;
  } | null>(null);
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
      selected.some(
        (clip) =>
          rootGroupId(project, clip.groupId) !==
          rootGroupId(project, selected[0].groupId),
      ));
  const groupId = rootGroupId(project, source?.groupId);
  const canRenameGroup =
    groupId &&
    groupMembers(project, groupId).every(
      (clip) =>
        !project.tracks.find((track) => track.id === clip.trackId)?.locked,
    );
  const canUngroup = canEdit && selected.some((clip) => !!clip.groupId);
  const canFit = canEdit && selected.some((clip) => clip.kind !== "audio");
  const canAlign =
    canEdit && canvasAlignmentTargets(project, ids, editor.playhead).length > 1;
  const stitchError = stitchSelectionError(project, ids);
  const canUnstitch =
    canEdit && selected.some((clip) => stitchBoundaries(clip).length > 0);
  const extensionTime =
    menu?.frameExtensionTime ?? editor.playhead - (source?.start ?? 0);
  const extension = source && frameExtensionAt(source, extensionTime);
  const extensionError = source && frameExtensionError(
    project, source.id, extensionTime, extension?.duration ?? 1,
  );
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
  const openSubmenu = (kind: SubmenuKind, focus = false) => {
    const button = kind === "arrange" ? arrangeButton : alignButton;
    const bounds = button.current?.getBoundingClientRect();
    if (!bounds || (kind === "arrange" ? !canEdit : !canAlign)) return;
    setSubmenu({
      kind,
      x:
        bounds.right + 180 < window.innerWidth
          ? bounds.right
          : bounds.left - 180,
      y: Math.max(
        8,
        Math.min(
          bounds.top,
          window.innerHeight - (kind === "align" ? 240 : 180),
        ),
      ),
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
          (document.activeElement === arrangeButton.current ||
            document.activeElement === alignButton.current)
        ) {
          event.preventDefault();
          openSubmenu(
            document.activeElement === alignButton.current
              ? "align"
              : "arrange",
            true,
          );
          return;
        }
        if (event.key === "ArrowLeft" && submenu) {
          event.preventDefault();
          setSubmenu(null);
          (submenu.kind === "align"
            ? alignButton
            : arrangeButton
          ).current?.focus();
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
      {surface === "timeline" && (
        <>
          {source?.kind === "video" && onExtendFrame && (
            <>
              <button
                role="menuitem"
                disabled={!!extensionError}
                title={extensionError ?? undefined}
                onPointerEnter={() => setSubmenu(null)}
                onClick={() => {
                  onExtendFrame(source.id, extensionTime);
                  onClose();
                }}
              >
                {extension ? "调整帧定格时长" : "帧定格…"}
              </button>
              {extension && (
                <button
                  role="menuitem"
                  disabled={!!frameExtensionError(project, source.id, extension.start, 0)}
                  onPointerEnter={() => setSubmenu(null)}
                  onClick={() => {
                    editor.apply((project) =>
                      setFrameExtension(project, source.id, extension.start, 0),
                    );
                    onClose();
                  }}
                >
                  移除帧定格
                </button>
              )}
            </>
          )}
          {onRename && !groupId && (
            <button
              role="menuitem"
              disabled={
                !source || !editableIds(project, [source.id]).has(source.id)
              }
              onPointerEnter={() => setSubmenu(null)}
              onClick={() => {
                if (source) onRename(source.id);
                onClose();
              }}
            >
              重命名
            </button>
          )}
          {menu.stitchTime !== undefined && source && (
            <button
              role="menuitem"
              disabled={!canEdit}
              onClick={() => {
                editor.unstitchSelectedClips(menu.stitchTime, source.id);
                onClose();
              }}
            >
              移除拼接
            </button>
          )}
          {menu.stitchTime === undefined && (
            <div title={stitchError ?? undefined}>
              {item("拼接所选媒体", "stitch", "Ctrl+Alt+I", !!stitchError)}
            </div>
          )}
          {canUnstitch &&
            item("移除全部拼接", "unstitch", "Ctrl+Shift+\\", false)}
          {item(
            "拆分视频和音频",
            "detachAudio",
            "",
            !canEdit || !detachableVideos(project, ids).length,
          )}
          <hr />
        </>
      )}
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
          {groupId && (
            <>
              <button
                role="menuitem"
                onClick={() => {
                  editor.switchTimeline(groupId);
                  onClose();
                }}
              >
                打开组
              </button>
              <button
                role="menuitem"
                disabled={!canRenameGroup}
                onClick={() => {
                  editor.setRenamingGroup(groupId);
                  onClose();
                }}
              >
                重命名组
              </button>
            </>
          )}
        </>
      )}
      {children && (
        <div className="clip-context-extras" onClick={onClose}>
          {children}
        </div>
      )}
      {surface === "canvas" && (
        <>
          <button
            ref={alignButton}
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={submenu?.kind === "align"}
            disabled={!canAlign}
            title="以所选对象的整体边界为参照对齐"
            onPointerEnter={() => openSubmenu("align")}
            onClick={() => openSubmenu("align", true)}
          >
            对齐
            <ChevronRight size={14} className="canvas-menu-arrow" />
          </button>
          <button
            ref={arrangeButton}
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={submenu?.kind === "arrange"}
            disabled={!canEdit}
            onPointerEnter={() => openSubmenu("arrange")}
            onClick={() => openSubmenu("arrange", true)}
          >
            排列
            <ChevronRight size={14} className="canvas-menu-arrow" />
          </button>
        </>
      )}
      {submenu && (
        <div
          ref={submenuRoot}
          role="menu"
          aria-label={submenu.kind === "align" ? "对齐" : "排列"}
          className="context-menu canvas-context-submenu"
          style={{ left: submenu.x, top: submenu.y }}
        >
          {submenu.kind === "align"
            ? alignments.map(([alignment, label]) => (
                <button
                  key={alignment}
                  role="menuitem"
                  disabled={!canAlign}
                  onClick={() => {
                    editor.alignClips(ids, alignment);
                    onClose();
                  }}
                >
                  {label}
                </button>
              ))
            : (
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
