import { useId } from "react";
import {
  transitionMime,
  supportsTransitions,
  transitionPresets,
  whipPanBlur,
} from "../shared/transitions";
import TransitionMotionBlur from "./TransitionMotionBlur";
import type { Editor } from "./useEditor";
import mountainPreview from "./assets/transitions/mountain-lake.svg";
import desertPreview from "./assets/transitions/desert.svg";

export default function TransitionsPanel({ editor }: { editor: Editor }) {
  const blurId = `transition-card-blur-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <div className="transitions-panel">
      <TransitionMotionBlur id={blurId} amount={whipPanBlur(0.5)} animated />
      <p className="panel-intro">
        拖到片头、片尾或相邻接点。拖到片段中部可同时添加到两端。
      </p>
      <div className="transition-grid">
        {transitionPresets.map(({ type, name }) => (
          <button
            key={type}
            className="transition-card"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(transitionMime, type);
              event.dataTransfer.effectAllowed = "copy";
            }}
            onDoubleClick={() => {
              if (editor.selected && supportsTransitions(editor.selected))
                editor.addTransition(
                  {
                    clipId: editor.selected.id,
                    side: "incoming",
                    both: true,
                  },
                  type,
                );
            }}
            title="拖到片段，或双击应用到所选片段两端"
          >
            <span
              className={`transition-card-preview ${type}`}
              aria-hidden="true"
            >
              <img
                src={mountainPreview}
                alt=""
                draggable={false}
                style={
                  type === "whip-pan"
                    ? { filter: `url(#${blurId})` }
                    : undefined
                }
              />
              <img
                src={desertPreview}
                alt=""
                draggable={false}
                style={
                  type === "whip-pan"
                    ? { filter: `url(#${blurId})` }
                    : undefined
                }
              />
            </span>
            <b>{name}</b>
          </button>
        ))}
      </div>
    </div>
  );
}
