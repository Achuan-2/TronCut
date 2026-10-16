import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { PresetLibrary } from "./usePresetLibrary";
import "./PresetLibrary.css";

function NameDialog({ library }: { library: PresetLibrary }) {
  const request = library.dialog!;
  const [name, setName] = useState(request.name);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const close = () => library.showDialog(null);
  const title = request.mode === "add" ? "添加行为预设" : "重命名行为预设";
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    input.current?.focus();
    input.current?.select();
    return () => {
      element?.close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="preset-name-dialog"
      aria-labelledby="preset-name-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          library.submitName(name);
        }}
      >
        <div className="modal-heading">
          <h3 id="preset-name-title">{title}</h3>
          <button type="button" aria-label="关闭预设编辑" onClick={close}>
            <X size={18} />
          </button>
        </div>
        <label className="field">
          预设名称
          <input
            ref={input}
            autoFocus
            aria-label="预设名称"
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {library.error && (
          <p className="preset-library-error" role="alert">
            {library.error}
          </p>
        )}
        <div className="preset-dialog-actions">
          <button className="primary" type="submit" disabled={!name.trim()}>
            确定
          </button>
          <button type="button" onClick={close}>
            取消
          </button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}

function LibraryMenu({ library }: { library: PresetLibrary }) {
  const menu = library.menu!;
  const root = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: menu.x, top: menu.y });
  const close = () => library.showMenu(null);
  const preset =
    menu.kind === "behavior" && menu.id ? library.findBehavior(menu.id) : null;
  const favorite = menu.id && library.isFavorite(menu.kind, menu.id);
  useLayoutEffect(() => {
    const bounds = root.current!.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(menu.x, innerWidth - bounds.width - 8)),
      top: Math.max(8, Math.min(menu.y, innerHeight - bounds.height - 8)),
    });
    root.current
      ?.querySelector<HTMLButtonElement>("button")
      ?.focus({ preventScroll: true });
  }, [menu]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    const dismiss = () => close();
    window.addEventListener("pointerdown", outside);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", dismiss);
    };
  }, []);
  return createPortal(
    <div
      ref={root}
      role="menu"
      aria-label="预设操作"
      className="context-menu preset-context-menu"
      style={position}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (["Escape", "Tab"].includes(event.key)) {
          close();
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        const buttons = Array.from(
          root.current!.querySelectorAll<HTMLButtonElement>("button"),
        );
        const index = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        buttons[
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (index + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) %
                buttons.length
        ]?.focus({ preventScroll: true });
      }}
      onClick={close}
    >
      {menu.id && (
        <button
          role="menuitem"
          onClick={() => library.toggleFavorite(menu.kind, menu.id!)}
        >
          {favorite ? "取消收藏" : "收藏"}
        </button>
      )}
      {preset && (
        <>
          <button
            role="menuitem"
            onClick={() =>
              library.showDialog({
                mode: "rename",
                id: preset.id,
                name: preset.name,
              })
            }
          >
            重命名
          </button>
          <button
            role="menuitem"
            onClick={() => library.deleteBehavior(preset.id)}
          >
            删除预设
          </button>
        </>
      )}
      {menu.kind === "behavior" && (
        <>
          {menu.id && (
            <div role="separator" className="preset-menu-separator" />
          )}
          <button role="menuitem" onClick={() => library.restoreDefaults()}>
            恢复所有默认行为
          </button>
        </>
      )}
    </div>,
    document.body,
  );
}

export default function PresetLibraryOverlays({
  library,
}: {
  library: PresetLibrary;
}) {
  return (
    <>
      {library.menu && <LibraryMenu library={library} />}
      {library.dialog && (
        <NameDialog
          key={library.dialog.mode === "add" ? "add" : library.dialog.id}
          library={library}
        />
      )}
    </>
  );
}
