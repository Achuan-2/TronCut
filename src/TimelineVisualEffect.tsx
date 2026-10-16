import { useRef } from "react";
import type { Clip } from "../shared/model";
import { effectWindow } from "../shared/effect-timing";
import {
  dragVisualEffectWindow,
  rangedVisualEffect,
  type RangedVisualEffectId,
} from "../shared/visual-effect-range";

export default function TimelineVisualEffect({
  clip,
  id,
  name,
  zoom,
  fps,
  locked,
  selected,
  select,
  preview,
  commit,
}: {
  clip: Clip;
  id: RangedVisualEffectId;
  name: string;
  zoom: number;
  fps: number;
  locked: boolean;
  selected: boolean;
  select: () => void;
  preview: (clip: Clip | null) => void;
  commit: (clip: Clip) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    x: number;
    mode: "start" | "end" | "move";
    original: Clip;
    value: Clip;
  } | null>(null);
  const effect = rangedVisualEffect(clip, id)!;
  const window = effectWindow(effect, clip.duration);
  const cancel = () => {
    gesture.current = null;
    preview(null);
  };
  return (
    <div className="clip-visual-effect-row" data-effect={id}>
      <div
        ref={ref}
        role="button"
        tabIndex={0}
        aria-label={`视觉效果 ${name}`}
        aria-pressed={selected}
        data-start={window.start}
        data-end={window.end}
        className={`clip-visual-effect ${selected ? "selected" : ""} ${effect.enabled === false ? "disabled" : ""} ${locked ? "locked" : ""}`}
        style={{
          left: `${(window.start / clip.duration) * 100}%`,
          width: `${((window.end - window.start) / clip.duration) * 100}%`,
        }}
        title={`${name} · ${window.start.toFixed(2)}–${window.end.toFixed(2)} 秒；拖动两端调整生效范围`}
        onClick={(event) => {
          event.stopPropagation();
          select();
        }}
        onDoubleClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => {
          event.stopPropagation();
          if (event.button !== 0) return;
          event.preventDefault();
          select();
          ref.current?.focus({ preventScroll: true });
          if (locked) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          const mode = (event.target as HTMLElement).dataset.edge;
          gesture.current = {
            x: event.clientX,
            mode: mode === "start" || mode === "end" ? mode : "move",
            original: clip,
            value: clip,
          };
        }}
        onPointerMove={(event) => {
          const drag = gesture.current;
          if (!drag) return;
          event.stopPropagation();
          drag.value = dragVisualEffectWindow(
            drag.original,
            id,
            drag.mode,
            (event.clientX - drag.x) / zoom,
            fps,
          );
          preview(drag.value);
        }}
        onPointerUp={(event) => {
          const drag = gesture.current;
          if (!drag) return;
          event.stopPropagation();
          gesture.current = null;
          if (drag.value !== drag.original) commit(drag.value);
          preview(null);
        }}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            cancel();
            return;
          }
          if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
          event.preventDefault();
          event.stopPropagation();
          if (locked || gesture.current) return;
          const edge = (event.target as HTMLElement).dataset.edge;
          const next = dragVisualEffectWindow(
            clip,
            id,
            edge === "start" || edge === "end" ? edge : "move",
            ((event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 10 : 1)) /
              fps,
            fps,
          );
          if (next !== clip) commit(next);
        }}
      >
        <span>{name}</span>
        {(["start", "end"] as const).map((edge) => (
          <button
            key={edge}
            type="button"
            className={`visual-effect-handle ${edge}`}
            data-edge={edge}
            disabled={locked}
            aria-label={`调整${name}${edge === "start" ? "开始" : "结束"}时间`}
            title={`拖动调整${edge === "start" ? "开始" : "结束"}时间`}
          />
        ))}
      </div>
    </div>
  );
}
