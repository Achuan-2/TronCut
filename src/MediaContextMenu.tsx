import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type MediaCommand =
  | "add"
  | "replace"
  | "update"
  | "delete"
  | "select"
  | "rename"
  | "export"
  | "new-folder"
  | "import"
  | "export-library"
  | "import-library";
export interface MediaMenuPosition {
  assetId: string;
  x: number;
  y: number;
}

export default function MediaContextMenu({
  menu,
  unavailable,
  onClose,
  onCommand,
  onSaveToLibrary,
  commands: customCommands,
  destinations,
  onTransfer,
  folderDestinations,
  onMoveToFolder,
}: {
  menu: MediaMenuPosition;
  unavailable: Partial<Record<MediaCommand, string>>;
  onClose: () => void;
  onCommand: (command: MediaCommand) => void;
  onSaveToLibrary?: () => void;
  commands?: [MediaCommand, string][];
  destinations?: { id: string; name: string }[];
  onTransfer?: (targetId: string, move: boolean) => void;
  folderDestinations?: { id: string; name: string }[];
  onMoveToFolder?: (folderId: string | null) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: menu.x, y: menu.y });
  const [submenu, setSubmenu] = useState<"copy" | "move" | "folder" | null>(
    null,
  );
  const focusSubmenu = useRef(false);
  const [submenuPosition, setSubmenuPosition] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    if (!submenu) return;
    const button = root.current?.querySelector<HTMLElement>(
      `[data-transfer="${submenu}"]`,
    );
    const list = root.current?.querySelector<HTMLElement>(
      "[data-transfer-menu]",
    );
    if (!button || !list) return;
    const bounds = button.getBoundingClientRect();
    const size = list.getBoundingClientRect();
    setSubmenuPosition({
      left: Math.max(
        8,
        bounds.right + size.width > innerWidth - 8
          ? bounds.left - size.width + 2
          : bounds.right - 2,
      ),
      top: Math.max(8, Math.min(bounds.top, innerHeight - size.height - 8)),
    });
    if (focusSubmenu.current) {
      list.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
      focusSubmenu.current = false;
    }
  }, [submenu, position.x, position.y]);
  useLayoutEffect(() => {
    const bounds = root.current!.getBoundingClientRect();
    setPosition({
      x: Math.max(8, Math.min(menu.x, innerWidth - bounds.width - 8)),
      y: Math.max(8, Math.min(menu.y, innerHeight - bounds.height - 8)),
    });
    root.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
  }, [menu]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);
  const commands: [MediaCommand, string][] = customCommands ?? [
    ["add", "添加到时间轴播放头所处位置"],
    ["replace", "替换时间轴上所选的媒体"],
    ["update", "更新"],
    ["delete", "删除"],
    ["select", "在时间线上选择"],
  ];
  return createPortal(
    <div
      ref={root}
      className="context-menu media-context-menu"
      role="menu"
      aria-label="媒体操作"
      style={{ left: position.x, top: position.y, width: 280 }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "ArrowLeft" && submenu) {
          event.preventDefault();
          root.current
            ?.querySelector<HTMLButtonElement>(`[data-transfer="${submenu}"]`)
            ?.focus();
          setSubmenu(null);
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        const scope =
          (event.target as HTMLElement).closest("[data-transfer-menu]") ??
          root.current!;
        const buttons = Array.from(
          scope.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
        ).filter(
          (button) =>
            scope !== root.current || !button.closest("[data-transfer-menu]"),
        );
        const current = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const index =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (current +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  buttons.length) %
                buttons.length;
        buttons[index]?.focus();
      }}
    >
      {commands.map(([command, label]) => (
        <button
          key={command}
          role="menuitem"
          disabled={!!unavailable[command]}
          title={unavailable[command]}
          onMouseEnter={() => setSubmenu(null)}
          onClick={() => {
            onClose();
            onCommand(command);
          }}
        >
          {label}
        </button>
      ))}
      {(onTransfer || onMoveToFolder) &&
        (onMoveToFolder
          ? (["folder"] as const)
          : (["copy", "move"] as const)
        ).map((mode) => (
          <div
            className="media-transfer-item"
            key={mode}
            onMouseEnter={() => setSubmenu(mode)}
          >
            <button
              role="menuitem"
              data-transfer={mode}
              aria-haspopup="menu"
              aria-expanded={submenu === mode}
              disabled={
                mode !== "folder" &&
                (!!unavailable.export || !destinations?.length)
              }
              title={
                mode === "folder"
                  ? undefined
                  : (unavailable.export ??
                    (!destinations?.length ? "请先创建其他素材库" : undefined))
              }
              onClick={() => setSubmenu(submenu === mode ? null : mode)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  if (submenu === mode) {
                    root.current
                      ?.querySelector<HTMLButtonElement>(
                        "[data-transfer-menu] button",
                      )
                      ?.focus();
                  } else {
                    focusSubmenu.current = true;
                    setSubmenu(mode);
                  }
                }
              }}
            >
              <span>
                {mode === "folder"
                  ? "移至文件夹"
                  : mode === "copy"
                    ? "复制到"
                    : "移动至"}
              </span>
              <span aria-hidden="true">›</span>
            </button>
            {submenu === mode && (
              <div
                role="menu"
                data-transfer-menu
                className="context-menu media-transfer-menu"
                style={submenuPosition}
                aria-label={
                  mode === "folder"
                    ? "移至文件夹"
                    : mode === "copy"
                      ? "复制到库"
                      : "移动至库"
                }
              >
                {(mode === "folder"
                  ? [{ id: "", name: "未分组" }, ...(folderDestinations ?? [])]
                  : destinations
                )?.map((library) => (
                  <button
                    key={library.id}
                    role="menuitem"
                    onClick={() => {
                      onClose();
                      if (mode === "folder")
                        onMoveToFolder?.(library.id || null);
                      else onTransfer?.(library.id, mode === "move");
                    }}
                  >
                    {library.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      {onSaveToLibrary && (
        <button
          role="menuitem"
          onClick={() => {
            onClose();
            onSaveToLibrary();
          }}
        >
          添加到素材库…
        </button>
      )}
    </div>,
    document.body,
  );
}
