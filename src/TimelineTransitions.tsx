import { useRef, useState } from "react";
import type { Clip } from "../shared/model";
import {
  pairedTransition,
  transitionDuration,
  transitionMarkerDuration,
  transitionSides,
  transitionName,
  type TransitionSide,
} from "../shared/transitions";
import type { Editor } from "./useEditor";

function TransitionMarker({
  clip,
  side,
  zoom,
  editor,
  locked,
}: {
  clip: Clip;
  side: TransitionSide;
  zoom: number;
  editor: Editor;
  locked: boolean;
}) {
  const transition = clip.transitions![side]!;
  const selection = { clipId: clip.id, side };
  const pair = pairedTransition(editor.project, clip, side);
  const selected = editor.selectedTransition;
  const isSelected =
    selected &&
    ((selected.clipId === clip.id && selected.side === side) ||
      (pair?.id === selected.clipId && selected.side !== side));
  const [draft, setDraft] = useState<number | null>(null);
  const gesture = useRef<{ x: number; duration: number; value: number } | null>(
    null,
  );
  const span =
    draft === null
      ? transitionMarkerDuration(editor.project, clip, side)
      : draft / (pair ? 2 : 1);
  return (
    <div
      className={`timeline-transition ${side} ${isSelected ? "selected" : ""} ${transition.enabled ? "" : "disabled"}`}
      role="button"
      tabIndex={0}
      aria-label={`${side === "incoming" ? "片头" : "片尾"}转换 ${transitionName(transition.type)}`}
      title={`${transitionName(transition.type)} · ${transitionDuration(editor.project, clip, side).toFixed(2)}s${pair ? " · 接点" : ""}`}
      style={{
        width: Math.min((clip.duration * zoom) / 2, Math.max(8, span * zoom)),
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (event.button === 0) editor.selectTransition(selection);
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          editor.selectTransition(selection);
        }
      }}
    >
      <span aria-hidden="true">|||</span>
      <div
        className="transition-resize"
        role="separator"
        aria-label="调整转换时长"
        aria-orientation="vertical"
        onPointerDown={(event) => {
          if (locked || event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          editor.selectTransition(selection);
          const duration = transitionDuration(editor.project, clip, side);
          gesture.current = { x: event.clientX, duration, value: duration };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const drag = gesture.current;
          if (!drag) return;
          const max = pair
            ? Math.min(clip.duration, pair.duration)
            : clip.duration / 2;
          const frames = Math.round(
            (drag.duration +
              ((event.clientX - drag.x) / zoom) *
                (side === "incoming" ? 1 : -1) *
                (pair ? 2 : 1)) *
              editor.project.canvas.fps,
          );
          drag.value = Math.max(
            Math.min(1 / editor.project.canvas.fps, max),
            Math.min(max, frames / editor.project.canvas.fps),
          );
          setDraft(drag.value);
        }}
        onPointerUp={(event) => {
          const drag = gesture.current;
          if (!drag) return;
          gesture.current = null;
          setDraft(null);
          event.currentTarget.releasePointerCapture(event.pointerId);
          if (drag.value !== drag.duration)
            editor.updateTransition(selection, { duration: drag.value });
        }}
        onPointerCancel={() => {
          gesture.current = null;
          setDraft(null);
        }}
      />
    </div>
  );
}

export default function TimelineTransitions(props: {
  clip: Clip;
  zoom: number;
  editor: Editor;
  locked: boolean;
}) {
  return transitionSides.map((side) =>
    props.clip.transitions?.[side] ? (
      <TransitionMarker key={side} {...props} side={side} />
    ) : null,
  );
}
