import { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { editableIds } from "../shared/timeline";
import type { Editor } from "./useEditor";

export default function ClipRenameDialog({
  editor,
  id,
  onClose,
}: {
  editor: Editor;
  id: string;
  onClose: () => void;
}) {
  const clip = editor.project.clips.find((clip) => clip.id === id);
  const [name, setName] = useState(clip?.name ?? "");
  if (!clip) return null;
  const canSave = !!name.trim() && editableIds(editor.project, [id]).has(id);
  return createPortal(
    <div
      className="modal-backdrop"
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
        className="caption-dialog track-rename-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="clip-rename-title"
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSave) return;
          editor.apply((project) => {
            const target = project.clips.find((clip) => clip.id === id);
            const trimmed = name.trim();
            if (
              !target ||
              target.name === trimmed ||
              !editableIds(project, [id]).has(id)
            )
              return project;
            return {
              ...project,
              clips: project.clips.map((clip) =>
                clip.id === id ? { ...clip, name: trimmed } : clip,
              ),
            };
          });
          onClose();
        }}
      >
        <div className="modal-heading">
          <h2 id="clip-rename-title">重命名素材</h2>
          <button type="button" aria-label="关闭重命名" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <label className="field vertical">
          素材名称
          <input
            autoFocus
            maxLength={200}
            value={name}
            onFocus={(event) => event.target.select()}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="preferences-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" type="submit" disabled={!canSave}>
            保存名称
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
