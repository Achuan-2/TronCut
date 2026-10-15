import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight, X } from "lucide-react";
import type { Editor } from "./useEditor";
import {
  displayTrackName,
  insertTrack,
  moveTrack,
  removeTrack,
  removeEmptyTracks,
  renameTrack,
  toggleTrack,
} from "../shared/tracks";
import "./TrackContextMenu.css";

export interface TrackMenuPosition {
  trackId: string;
  x: number;
  y: number;
}

export default function TrackContextMenu({
  editor,
  menu,
  onClose,
}: {
  editor: Editor;
  menu: TrackMenuPosition | null;
  onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [submenu, setSubmenu] = useState<{
    name: "insert" | "move";
    x: number;
    y: number;
  } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(
    null,
  );
  const track = editor.project.tracks.find(
    (track) => track.id === menu?.trackId,
  );
  const index = editor.project.tracks.findIndex(
    (item) => item.id === track?.id,
  );
  const count = editor.project.tracks.length;
  const media = editor.project.clips.filter(
    (clip) => clip.trackId === track?.id,
  );
  useLayoutEffect(() => {
    if (!menu) return;
    setSubmenu(null);
    const bounds = root.current?.getBoundingClientRect();
    setPosition({
      x: Math.max(
        8,
        Math.min(menu.x, window.innerWidth - (bounds?.width ?? 252) - 8),
      ),
      y: Math.max(
        8,
        Math.min(menu.y, window.innerHeight - (bounds?.height ?? 380) - 8),
      ),
    });
    root.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
  }, [menu]);
  useEffect(() => {
    if (!menu && !renaming) return;
    const outside = (event: PointerEvent) => {
      if (menu && !root.current?.contains(event.target as Node)) onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setRenaming(null);
        onClose();
      }
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", escape, true);
    };
  }, [menu, renaming, onClose]);
  const openSubmenu = (name: "insert" | "move", button: HTMLButtonElement) => {
    const bounds = button.getBoundingClientRect();
    setSubmenu({
      name,
      x:
        bounds.right + 170 < window.innerWidth
          ? bounds.right
          : bounds.left - 170,
      y: Math.min(
        bounds.top,
        window.innerHeight - (name === "insert" ? 90 : 160) - 8,
      ),
    });
  };
  const apply = (operation: Parameters<typeof editor.apply>[0]) => {
    editor.apply(operation);
    onClose();
  };
  const checked = (value: boolean | undefined) => (
    <span className="track-menu-check">{value && <Check size={14} />}</span>
  );
  return createPortal(
    <>
      {menu && track && (
        <div
          ref={root}
          className="context-menu track-context-menu"
          role="menu"
          aria-label="轨道操作"
          style={{ left: position.x, top: position.y }}
          onContextMenu={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            const buttons = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                "button:not(:disabled)",
              ),
            );
            const current = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            buttons[
              (current + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) %
                buttons.length
            ]?.focus();
          }}
        >
          <button
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={submenu?.name === "insert"}
            disabled={count >= 128}
            onPointerEnter={(event) =>
              count < 128 && openSubmenu("insert", event.currentTarget)
            }
            onClick={(event) => openSubmenu("insert", event.currentTarget)}
          >
            {checked(false)}插入轨道
            <ChevronRight size={14} className="track-menu-arrow" />
          </button>
          <button
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={submenu?.name === "move"}
            disabled={count < 2}
            onPointerEnter={(event) =>
              count > 1 && openSubmenu("move", event.currentTarget)
            }
            onClick={(event) => openSubmenu("move", event.currentTarget)}
          >
            {checked(false)}移动轨道
            <ChevronRight size={14} className="track-menu-arrow" />
          </button>
          <button
            role="menuitem"
            disabled={track.locked || count < 2}
            onPointerEnter={() => setSubmenu(null)}
            onClick={() => apply((project) => removeTrack(project, track.id))}
          >
            {checked(false)}移除轨道
          </button>
          <button
            role="menuitem"
            disabled={removeEmptyTracks(editor.project) === editor.project}
            onPointerEnter={() => setSubmenu(null)}
            onClick={() => apply(removeEmptyTracks)}
          >
            {checked(false)}移除所有空轨道
          </button>
          <hr />
          <button
            role="menuitem"
            onPointerEnter={() => setSubmenu(null)}
            onClick={() => {
              setRenaming({
                id: track.id,
                name: displayTrackName(editor.project.tracks, track.id),
              });
              onClose();
            }}
          >
            {checked(false)}重命名轨道
          </button>
          <button
            role="menuitem"
            disabled={!media.length}
            onPointerEnter={() => setSubmenu(null)}
            onClick={() => {
              editor.select(null);
              editor.selectMany(media.map((clip) => clip.id));
              onClose();
            }}
          >
            {checked(false)}选择轨道上的所有媒体
          </button>
          <hr />
          <button
            role="menuitemcheckbox"
            aria-checked={track.hidden}
            onPointerEnter={() => setSubmenu(null)}
            onClick={() =>
              apply((project) => toggleTrack(project, track.id, "hidden"))
            }
          >
            {checked(track.hidden)}
            {track.hidden ? "显示轨道" : "关闭轨道（隐藏）"}
          </button>
          <button
            role="menuitemcheckbox"
            aria-checked={!!track.solo}
            onPointerEnter={() => setSubmenu(null)}
            onClick={() =>
              apply((project) => toggleTrack(project, track.id, "solo"))
            }
          >
            {checked(track.solo)}启用独奏轨道
          </button>
          <button
            role="menuitemcheckbox"
            aria-checked={track.locked}
            onPointerEnter={() => setSubmenu(null)}
            onClick={() =>
              apply((project) => toggleTrack(project, track.id, "locked"))
            }
          >
            {checked(track.locked)}锁定轨道
          </button>
          {submenu && (
            <div
              className="context-menu track-context-submenu"
              role="menu"
              aria-label={
                submenu.name === "insert" ? "插入轨道位置" : "移动轨道位置"
              }
              style={{ left: submenu.x, top: submenu.y }}
            >
              {submenu.name === "insert" ? (
                <>
                  <button
                    role="menuitem"
                    onClick={() =>
                      apply((project) =>
                        insertTrack(project, track.id, "above"),
                      )
                    }
                  >
                    在上方插入
                  </button>
                  <button
                    role="menuitem"
                    onClick={() =>
                      apply((project) =>
                        insertTrack(project, track.id, "below"),
                      )
                    }
                  >
                    在下方插入
                  </button>
                </>
              ) : (
                <>
                  <button
                    role="menuitem"
                    disabled={index === 0}
                    onClick={() =>
                      apply((project) => moveTrack(project, track.id, "up"))
                    }
                  >
                    上移轨道
                  </button>
                  <button
                    role="menuitem"
                    disabled={index === count - 1}
                    onClick={() =>
                      apply((project) => moveTrack(project, track.id, "down"))
                    }
                  >
                    下移轨道
                  </button>
                  <button
                    role="menuitem"
                    disabled={index === 0}
                    onClick={() =>
                      apply((project) => moveTrack(project, track.id, "top"))
                    }
                  >
                    移到顶部
                  </button>
                  <button
                    role="menuitem"
                    disabled={index === count - 1}
                    onClick={() =>
                      apply((project) => moveTrack(project, track.id, "bottom"))
                    }
                  >
                    移到底部
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
      {renaming && (
        <div className="modal-backdrop" onPointerDown={() => setRenaming(null)}>
          <form
            className="caption-dialog track-rename-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="track-rename-title"
            onPointerDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              if (!renaming.name.trim()) return;
              editor.apply((project) =>
                renameTrack(project, renaming.id, renaming.name),
              );
              setRenaming(null);
            }}
          >
            <div className="modal-heading">
              <h2 id="track-rename-title">重命名轨道</h2>
              <button
                type="button"
                aria-label="关闭重命名"
                onClick={() => setRenaming(null)}
              >
                <X size={18} />
              </button>
            </div>
            <label className="field vertical">
              轨道名称
              <input
                autoFocus
                maxLength={100}
                value={renaming.name}
                onFocus={(event) => event.target.select()}
                onChange={(event) =>
                  setRenaming({ ...renaming, name: event.target.value })
                }
              />
            </label>
            <div className="preferences-actions">
              <button type="button" onClick={() => setRenaming(null)}>
                取消
              </button>
              <button
                className="primary"
                type="submit"
                disabled={!renaming.name.trim()}
              >
                保存名称
              </button>
            </div>
          </form>
        </div>
      )}
    </>,
    document.body,
  );
}
