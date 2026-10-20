import { useEffect, useId, useRef } from "react";
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
  const whipPreview = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const image = whipPreview.current?.querySelector("img");
    const blur = document
      .getElementById(blurId)
      ?.querySelector("feGaussianBlur");
    const motion = image?.getAnimations()[0];
    if (!motion || !blur) return;
    let frame: number;
    const update = () => {
      // Read the CSS pan's clock instead of running an independent SVG clock.
      // The pan occupies 20–55% of the 2.4s card cycle (see styles.css).
      const elapsed = Number(motion.currentTime ?? 0) % 2400;
      const progress = (elapsed / 2400 - 0.2) / 0.35;
      // Small thumbnails need a stronger smear to keep the fast pan legible.
      blur.setStdDeviation(whipPanBlur(progress) * 2.5, 0);
      frame = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(frame);
  }, [blurId]);
  return (
    <div className="transitions-panel">
      <TransitionMotionBlur id={blurId} amount={0} />
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
              ref={type === "whip-pan" ? whipPreview : undefined}
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
