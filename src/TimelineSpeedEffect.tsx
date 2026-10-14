import { useRef } from "react";
import type { Clip } from "../shared/model";
import { setSpeedDuration } from "../shared/clip-speed";

export default function TimelineSpeedEffect({
  clip,
  zoom,
  fps,
  locked,
  selected,
  offsetY = 0,
  select,
  preview,
  commit,
}: {
  clip: Clip;
  zoom: number;
  fps: number;
  locked: boolean;
  selected: boolean;
  offsetY?: number;
  select: () => void;
  preview: (clip: Clip | null) => void;
  commit: (clip: Clip) => void;
}) {
  const gesture = useRef<{ x: number; original: Clip; value: Clip } | null>(
    null,
  );
  return (
    <div
      className={`clip-speed-effect ${selected ? "selected" : ""} ${locked ? "locked" : ""}`}
      style={{
        left: clip.start * zoom,
        width: Math.max(4, clip.duration * zoom),
        translate: offsetY ? `0 ${offsetY}px` : undefined,
      }}
      onClick={select}
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
