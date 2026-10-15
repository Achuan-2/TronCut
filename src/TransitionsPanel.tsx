import { transitionMime, supportsTransitions } from "../shared/transitions";
import type { Editor } from "./useEditor";

export default function TransitionsPanel({ editor }: { editor: Editor }) {
  return (
    <div className="transitions-panel">
      <p className="panel-intro">
        拖到片头、片尾或相邻接点。拖到片段中部可同时添加到两端。
      </p>
      <button
        className="transition-card"
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData(transitionMime, "smooth-slide");
          event.dataTransfer.effectAllowed = "copy";
        }}
        onDoubleClick={() => {
          if (editor.selected && supportsTransitions(editor.selected))
            editor.addTransition({
              clipId: editor.selected.id,
              side: "incoming",
              both: true,
            });
        }}
        title="拖到片段，或双击应用到所选片段两端"
      >
        <span className="transition-card-preview" aria-hidden="true">
          <span>A</span>
          <span>B</span>
        </span>
        <b>Smooth Slide</b>
      </button>
    </div>
  );
}
