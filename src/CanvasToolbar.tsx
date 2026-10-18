import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Crop, MousePointer2, Settings2, Undo2, X, PenTool } from "lucide-react";
import type { Project } from "../shared/model";
import type { Editor } from "./useEditor";
import { transformAt } from "../shared/editor";
import { visualClipAt } from "../shared/visual-state";

export type CanvasMode = "select" | "crop" | "draw";
export type CanvasZoom = "fit" | number;
const zoomPresets = [25, 50, 75, 100, 200, 300, 800, 1200, 1600, 2000];
const presets = [
  { width: 1920, height: 1080, name: "横屏 · 1920 × 1080" },
  { width: 1080, height: 1920, name: "竖屏 · 1080 × 1920" },
  { width: 1080, height: 1080, name: "方形 · 1080 × 1080" },
  { width: 1280, height: 720, name: "720p · 1280 × 720" },
  { width: 3840, height: 2160, name: "4K · 3840 × 2160" },
];

function CanvasSettings({
  canvas,
  onApply,
  onClose,
}: {
  canvas: Project["canvas"];
  onApply: (canvas: Project["canvas"]) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(canvas);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="canvas-settings"
      aria-labelledby="canvas-settings-title"
      onCancel={onClose}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onApply(draft);
          onClose();
        }}
      >
        <div className="modal-heading">
          <div>
            <h2 id="canvas-settings-title">画布大小设置</h2>
            <p>设置工程和导出视频的画布尺寸</p>
          </div>
          <button type="button" aria-label="关闭画布设置" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        <label className="field">
          预设尺寸
          <select
            aria-label="预设尺寸"
            value={presets.findIndex(
              (item) =>
                item.width === draft.width && item.height === draft.height,
            )}
            onChange={(event) => {
              const preset = presets[Number(event.target.value)];
              if (preset)
                setDraft({
                  ...draft,
                  width: preset.width,
                  height: preset.height,
                });
            }}
          >
            <option value={-1}>自定义</option>
            {presets.map((item, index) => (
              <option key={item.name} value={index}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <div className="canvas-size-fields">
          <label className="field">
            宽度（像素）
            <input
              type="number"
              required
              min={16}
              max={7680}
              step={1}
              value={draft.width || ""}
              onChange={(event) =>
                setDraft({ ...draft, width: Number(event.target.value) })
              }
            />
          </label>
          <label className="field">
            高度（像素）
            <input
              type="number"
              required
              min={16}
              max={4320}
              step={1}
              value={draft.height || ""}
              onChange={(event) =>
                setDraft({ ...draft, height: Number(event.target.value) })
              }
            />
          </label>
        </div>
        <div className="canvas-size-fields">
          <label className="field">
            帧率
            <input
              type="number"
              required
              min={1}
              max={120}
              step={1}
              value={draft.fps || ""}
              onChange={(event) =>
                setDraft({ ...draft, fps: Number(event.target.value) })
              }
            />
          </label>
          <label className="field">
            画布背景
            <input
              type="color"
              value={draft.background}
              onChange={(event) =>
                setDraft({ ...draft, background: event.target.value })
              }
            />
          </label>
        </div>
        <div className="canvas-settings-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="primary">
            应用
          </button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}

export default function CanvasToolbar({
  editor,
  mode,
  setMode,
  zoom,
  setZoom,
  scale,
  onResetCrop,
}: {
  editor: Editor;
  mode: CanvasMode;
  setMode: (mode: CanvasMode) => void;
  zoom: CanvasZoom;
  setZoom: (zoom: CanvasZoom) => void;
  scale: number;
  onResetCrop: () => void;
}) {
  const [settings, setSettings] = useState(false);
  const sampled = editor.selected
    ? visualClipAt(
        editor.selected,
        transformAt(editor.selected, editor.playhead - editor.selected.start),
      )
    : null;
  const crop = sampled?.crop;
  const content = sampled?.contentTransform;
  const canReset =
    ((crop && Object.values(crop).some((value) => value > 0)) ||
      (content &&
        (content.scale !== 1 || content.x !== 0 || content.y !== 0))) &&
    !editor.project.tracks.find(
      (track) => track.id === editor.selected?.trackId,
    )?.locked;
  const changeMode = (next: CanvasMode) => {
    editor.setPlaying(false);
    if (editor.editingTextId) editor.endTextEdit(editor.editingTextId);
    setMode(next);
  };
  return (
    <>
      <div className="canvas-toolbar" role="toolbar" aria-label="画布工具">
        <div className="canvas-mode-buttons">
          <button
            aria-label="选择模式"
            title="选择模式：移动和调整素材尺寸"
            aria-pressed={mode === "select"}
            className={mode === "select" ? "active" : ""}
            onClick={() => changeMode("select")}
          >
            <MousePointer2 size={18} />
          </button>
          <button
            aria-label="裁剪模式"
            title="裁剪模式：拖动边缘裁剪，拖动画面平移，属性缩放只调整框内内容"
            aria-pressed={mode === "crop"}
            className={mode === "crop" ? "active" : ""}
            onClick={() => changeMode("crop")}
          >
            <Crop size={18} />
          </button>
        </div>
        <button
          aria-label="涂鸦笔模式"
          title="在画布上绘制可编辑笔迹"
          aria-pressed={mode === "draw"}
          className={`canvas-pen-button${mode === "draw" ? " active" : ""}`}
          onClick={editor.activatePen}
        >
          <PenTool size={18} />
        </button>
        <select
          aria-label="画布显示比例"
          title="画布缩放：Ctrl/⌘ + 加减号，或 Ctrl/⌘ + 滚轮"
          value={zoom}
          onChange={(event) => {
            if (event.target.value === "settings") {
              editor.setPlaying(false);
              setSettings(true);
            } else
              setZoom(
                event.target.value === "fit"
                  ? "fit"
                  : Number(event.target.value),
              );
          }}
        >
          <option value="fit">适合 · {Math.round(scale * 100)}%</option>
          {typeof zoom === "number" && !zoomPresets.includes(zoom * 100) && (
            <option value={zoom}>{Number((zoom * 100).toFixed(1))}%</option>
          )}
          {zoomPresets.map((percent) => (
            <option key={percent} value={percent / 100}>
              {percent}%
            </option>
          ))}
          <option value="settings">画布大小设置…</option>
        </select>
        {mode === "crop" && (
          <button
            aria-label="恢复裁剪"
            title="恢复所选素材的完整画面"
            disabled={!canReset}
            onClick={onResetCrop}
          >
            <Undo2 size={16} />
          </button>
        )}
        <button
          className="canvas-size-button"
          aria-label="画布大小设置"
          title="画布大小设置"
          onClick={() => {
            editor.setPlaying(false);
            if (editor.editingTextId) editor.endTextEdit(editor.editingTextId);
            setSettings(true);
          }}
        >
          <Settings2 size={15} />
          <span>
            {editor.project.canvas.width} × {editor.project.canvas.height}
          </span>
        </button>
      </div>
      {settings && (
        <CanvasSettings
          canvas={editor.project.canvas}
          onApply={(canvas) =>
            editor.apply((project) => ({ ...project, canvas }))
          }
          onClose={() => setSettings(false)}
        />
      )}
    </>
  );
}
