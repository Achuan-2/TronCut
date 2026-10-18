import { useState } from "react";
import { createPortal } from "react-dom";
import { FolderOpen, X } from "lucide-react";
import { groupName } from "../shared/clip-groups";
import type { Editor } from "./useEditor";
import "./GroupTimeline.css";

export default function GroupTimelineNavigation({
  editor,
}: {
  editor: Editor;
}) {
  if (!editor.timelineTabs.length) return null;
  const tabs = [{ id: null, name: "主时间线" }, ...editor.timelineTabs];
  return (
    <div className="timeline-tabs" role="tablist" aria-label="时间线">
      {tabs.map((tab, index) => (
        <div
          className={`timeline-tab ${editor.activeGroupId === tab.id ? "active" : ""}`}
          key={tab.id ?? "main"}
        >
          <button
            type="button"
            role="tab"
            aria-selected={editor.activeGroupId === tab.id}
            tabIndex={editor.activeGroupId === tab.id ? 0 : -1}
            onClick={() => editor.switchTimeline(tab.id)}
            onKeyDown={(event) => {
              let next: number;
              if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
              else if (event.key === "ArrowLeft")
                next = (index + tabs.length - 1) % tabs.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = tabs.length - 1;
              else return;
              event.preventDefault();
              editor.switchTimeline(tabs[next].id);
              event.currentTarget
                .closest('[role="tablist"]')
                ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                [next]?.focus();
            }}
          >
            {tab.id && <FolderOpen size={13} />}
            <span title={tab.name}>{tab.name}</span>
          </button>
          {tab.id && (
            <button
              type="button"
              className="timeline-tab-close"
              aria-label={`关闭${tab.name}时间线`}
              onClick={() => editor.closeGroup(tab.id!)}
            >
              <X size={13} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function RenameDialog({ editor, id }: { editor: Editor; id: string }) {
  const [name, setName] = useState(() => groupName(editor.documentProject, id));
  const close = () => editor.setRenamingGroup(null);
  return createPortal(
    <div className="modal-backdrop" onPointerDown={close}>
      <form
        className="caption-dialog track-rename-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-rename-title"
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            close();
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          editor.renameGroup(id, name);
          close();
        }}
      >
        <div className="modal-heading">
          <h2 id="group-rename-title">重命名组</h2>
          <button type="button" aria-label="关闭重命名" onClick={close}>
            <X size={18} />
          </button>
        </div>
        <label className="field vertical">
          组合名称
          <input
            autoFocus
            maxLength={100}
            value={name}
            onFocus={(event) => event.target.select()}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="preferences-actions">
          <button type="button" onClick={close}>
            取消
          </button>
          <button className="primary" type="submit" disabled={!name.trim()}>
            保存名称
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

export function GroupRenameDialog({ editor }: { editor: Editor }) {
  return editor.renamingGroup ? (
    <RenameDialog
      key={editor.renamingGroup}
      editor={editor}
      id={editor.renamingGroup}
    />
  ) : null;
}
