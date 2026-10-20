import { useState } from "react";
import { createPortal } from "react-dom";
import {
  frameExtensionAt,
  frameExtensionError,
  setFrameExtension,
} from "../shared/frame-extension";
import type { Editor } from "./useEditor";

export default function FrameExtensionDialog({
  editor,
  id,
  local,
  x,
  y,
  onClose,
}: {
  editor: Editor;
  id: string;
  local: number;
  x: number;
  y: number;
  onClose: () => void;
}) {
  const clip = editor.project.clips.find((clip) => clip.id === id);
  const existing = clip && frameExtensionAt(clip, local);
  const [seconds, setSeconds] = useState(String(existing?.duration ?? 1));
  const value = Number(seconds);
  const error =
    seconds.trim() && value >= 1 / editor.project.canvas.fps
      ? frameExtensionError(editor.project, id, local, value)
      : "请输入至少一帧的持续时间";
  return createPortal(
    <div
      className="modal-backdrop frame-extension-backdrop"
      onPointerDown={onClose}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <form
        className="caption-dialog frame-extension-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="frame-extension-title"
        style={{
          left: Math.max(8, Math.min(x, window.innerWidth - 348)),
          top: Math.max(8, Math.min(y - 180, window.innerHeight - 190)),
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (error) return;
          editor.apply((project) =>
            setFrameExtension(project, id, local, value),
          );
          onClose();
        }}
      >
        <h3 id="frame-extension-title">{existing ? "编辑帧定格" : "帧定格"}</h3>
        <label className="field">
          持续时间（秒）
          <input
            autoFocus
            type="number"
            min={1 / editor.project.canvas.fps}
            max={86400}
            step="any"
            value={seconds}
            onFocus={(event) => event.target.select()}
            onChange={(event) => setSeconds(event.target.value)}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="preferences-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="primary" disabled={!!error}>
            确定
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
