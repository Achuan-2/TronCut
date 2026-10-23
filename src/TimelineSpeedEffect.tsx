import { useRef } from "react";
import type { Clip } from "../shared/model";
import { setSpeedDuration } from "../shared/clip-speed";

export default function TimelineSpeedEffect({
  clip,
  zoom,
  fps,
  locked,
  selected,
  select,
  onContextMenu,
  preview,
  commit,
}: {
  clip: Clip;
  zoom: number;
  fps: number;
  locked: boolean;
  selected: boolean;
  select: () => void;
  onContextMenu: (x: number, y: number) => void;
  preview: (clip: Clip | null) => void;
  commit: (clip: Clip) => void;
}) {
  const gesture = useRef<{ x: number; original: Clip; value: Clip } | null>(
    null,
  );
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="效果 剪辑速度"
      aria-pressed={selected}
      className={`clip-speed-effect ${selected ? "selected" : ""} ${locked ? "locked" : ""}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        select();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        select();
        onContextMenu(event.clientX, event.clientY);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          select();
        }
      }}
    >
      <span>剪辑速度 · {Number(clip.speed.toFixed(2))}×</span>
      <button
        type="button"
        className="speed-effect-handle"
        title="拖动末端调整剪辑速度"
        aria-label="拖动末端调整剪辑速度"
        disabled={locked}
        onPointerDown={(event) => {
          if (event.button !== 0 || locked) return;
          event.preventDefault();
          event.stopPropagation();
          select();
          event.currentTarget.setPointerCapture(event.pointerId);
          gesture.current = { x: event.clientX, original: clip, value: clip };
        }}
        onPointerMove={(event) => {
          const drag = gesture.current;
          if (!drag) return;
          const duration = Math.max(
            1 / fps,
            Math.round(
              (drag.original.duration + (event.clientX - drag.x) / zoom) * fps,
            ) / fps,
          );
          drag.value = setSpeedDuration(drag.original, duration, fps);
          preview(drag.value);
        }}
        onPointerUp={(event) => {
          if (!gesture.current) return;
          event.stopPropagation();
          const value = gesture.current.value;
          gesture.current = null;
          commit(value);
          preview(null);
        }}
        onPointerCancel={() => {
          gesture.current = null;
          preview(null);
        }}
      />
    </div>
  );
}
