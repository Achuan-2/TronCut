import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";
import { editableIds, selectionWithGroups } from "../shared/timeline";
import {
  isTimelineClipColor,
  setTimelineClipColor,
  timelineClipColors,
} from "../shared/timeline-clip-color";
import { timelineClipColorStyle } from "./timeline-clip-color";
import type { Editor } from "./useEditor";
import "./ClipColorDialog.css";

export default function ClipColorDialog({
  editor,
  ids,
  onClose,
}: {
  editor: Editor;
  ids: string[];
  onClose: () => void;
}) {
  const selected = editor.project.clips.filter((clip) => ids.includes(clip.id));
  const initial = selected[0]?.timelineColor;
  const [color, setColor] = useState<string | null | undefined>(
    selected.every((clip) => clip.timelineColor === initial) ? initial : null,
  );
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const targets = selectionWithGroups(editor.project, ids);
  const editable = editableIds(editor.project, targets);
  const canSave =
    targets.length > 0 &&
    targets.every((id) => editable.has(id)) &&
    color !== null &&
    (color === undefined || isTimelineClipColor(color));
  const custom = color && isTimelineClipColor(color) ? color : "#527db6";
  return createPortal(
    <dialog
      ref={dialog}
      className="clip-color-dialog"
      aria-labelledby="clip-color-title"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSave) return;
          editor.apply((project) =>
            setTimelineClipColor(project, ids, color ?? undefined),
          );
          onClose();
        }}
      >
        <div className="modal-heading">
          <h2 id="clip-color-title">设置素材颜色</h2>
          <button type="button" aria-label="关闭颜色设置" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="clip-color-presets" role="group" aria-label="预设颜色">
          {timelineClipColors.map((preset) => (
            <button
              key={preset.color}
              type="button"
              aria-label={preset.name}
              title={preset.name}
              aria-pressed={color?.toLowerCase() === preset.color}
              style={timelineClipColorStyle(preset.color)}
              onClick={() => setColor(preset.color)}
            >
              {color?.toLowerCase() === preset.color && <Check size={19} />}
            </button>
          ))}
        </div>
        <div className="clip-custom-color">
          <label>
            自定义颜色
            <input
              type="color"
              aria-label="自定义颜色"
              value={custom}
              onChange={(event) => setColor(event.target.value)}
            />
          </label>
          <label>
            颜色值
            <input
              type="text"
              aria-label="颜色值"
              placeholder="#RRGGBB"
              maxLength={7}
              value={color ?? ""}
              onChange={(event) => setColor(event.target.value)}
              aria-invalid={!!color && !isTimelineClipColor(color)}
            />
          </label>
        </div>
        <button
          type="button"
          className="clip-color-default"
          aria-pressed={color === undefined}
          onClick={() => setColor(undefined)}
        >
          恢复默认颜色
        </button>
        <div className="preferences-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="primary" disabled={!canSave}>
            应用颜色
          </button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}
