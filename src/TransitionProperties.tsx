import { X } from "lucide-react";
import { transitionPresets, transitionTypeSchema } from "../shared/transitions";
import type { Editor } from "./useEditor";

export default function TransitionProperties({ editor }: { editor: Editor }) {
  const selection = editor.selectedTransition!;
  const clip = editor.project.clips.find((c) => c.id === selection.clipId)!;
  const transition = clip.transitions![selection.side]!;
  const locked = editor.project.tracks.find(
    (track) => track.id === clip.trackId,
  )?.locked;
  return (
    <aside className="inspector transition-inspector">
      <div className="panel-heading">
        <span>转换</span>
        <div className="transition-heading-actions">
          <button
            className="icon-button"
            aria-label="删除转换"
            disabled={locked}
            onClick={() => editor.updateTransition(selection, null)}
          >
            <X size={18} />
          </button>
          <button
            className="transition-switch"
            role="switch"
            aria-label="启用转换"
            aria-checked={transition.enabled}
            disabled={locked}
            onClick={() =>
              editor.updateTransition(selection, {
                enabled: !transition.enabled,
              })
            }
          >
            <i />
          </button>
        </div>
      </div>
      <fieldset disabled={locked} className="transition-fields">
        <label className="field">
          类型
          <select
            value={transition.type}
            onChange={(event) =>
              editor.updateTransition(selection, {
                type: transitionTypeSchema.parse(event.target.value),
              })
            }
          >
            {transitionPresets.map(({ type, name }) => (
              <option key={type} value={type}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {transition.type !== "fade" && (
          <label className="transition-reverse">
            <input
              type="checkbox"
              checked={transition.reverse}
              onChange={(event) =>
                editor.updateTransition(selection, {
                  reverse: event.target.checked,
                })
              }
            />
            反转
          </label>
        )}
      </fieldset>
    </aside>
  );
}
