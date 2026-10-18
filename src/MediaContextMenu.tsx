import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type MediaCommand = "add" | "replace" | "update" | "delete" | "select";
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
}: {
  menu: MediaMenuPosition;
  unavailable: Partial<Record<MediaCommand, string>>;
  onClose: () => void;
  onCommand: (command: MediaCommand) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: menu.x, y: menu.y });
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
  const commands: [MediaCommand, string][] = [
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
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        const buttons = Array.from(
          root.current!.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ),
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
          onClick={() => {
            onClose();
            onCommand(command);
          }}
        >
          {label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
