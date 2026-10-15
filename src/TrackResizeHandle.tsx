import { useRef } from "react";
import { defaultTrackHeight, maxTrackHeight } from "../shared/tracks";

export default function TrackResizeHandle({
  name,
  height,
  minHeight,
  preview,
  commit,
}: {
  name: string;
  height: number;
  minHeight: number;
  preview: (height: number | null) => void;
  commit: (height: number) => void;
}) {
  const gesture = useRef<{
    pointerId: number;
    y: number;
    height: number;
  } | null>(null);
  const clamp = (value: number) =>
    Math.max(minHeight, Math.min(maxTrackHeight, Math.round(value)));
  const cancel = () => {
    if (!gesture.current) return;
    gesture.current = null;
    preview(null);
  };
  return (
    <button
      type="button"
      className="track-resize-handle"
      role="separator"
      aria-label={`调整${name}高度`}
      aria-orientation="horizontal"
      aria-valuenow={height}
      aria-valuemin={minHeight}
      aria-valuemax={maxTrackHeight}
      title="拖动调整轨道高度；双击恢复默认高度"
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => {
        event.stopPropagation();
        commit(defaultTrackHeight);
      }}
      onKeyDown={(event) => {
        if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        event.stopPropagation();
        commit(
          event.key === "Home"
            ? defaultTrackHeight
            : event.key === "End"
              ? maxTrackHeight
              : clamp(
                  height +
                    (event.key === "ArrowDown" ? 1 : -1) *
                      (event.shiftKey ? 32 : 8),
                ),
        );
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        gesture.current = {
          pointerId: event.pointerId,
          y: event.clientY,
          height,
        };
        preview(height);
      }}
      onPointerMove={(event) => {
        const drag = gesture.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        preview(clamp(drag.height + event.clientY - drag.y));
      }}
      onPointerUp={(event) => {
        const drag = gesture.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        gesture.current = null;
        preview(null);
        // Preview stays local; commit once so one drag is one undo step.
        commit(clamp(drag.height + event.clientY - drag.y));
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
    />
  );
}
