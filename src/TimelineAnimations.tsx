import type { Clip } from "../shared/model";
import { useRef, useState, type PointerEvent } from "react";
import {
  animationRanges,
  retimeAnimation,
  type AnimationRange,
  type AnimationDragMode,
} from "../shared/animation-ranges";
import { timeLabel } from "./Preview";

export function TimelineAnimations({
  clip,
  zoom,
  playhead,
  fps,
  selected,
  locate,
  locked,
  commit,
}: {
  clip: Clip;
  zoom: number;
  playhead: number;
  fps: number;
  selected: boolean;
  locate: (time: number) => void;
  locked: boolean;
  commit: (clip: Clip) => void;
}) {
  type Gesture = {
    x: number;
    original: Clip;
    range: AnimationRange;
    mode: AnimationDragMode;
    value: Clip;
    moved: boolean;
  };
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const live = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const setDrag = (next: Gesture | null) => {
    live.current = next;
    setGesture(next);
  };
  const begin = (
    event: PointerEvent<HTMLButtonElement>,
    range: AnimationRange,
    mode: AnimationDragMode,
  ) => {
    event.stopPropagation();
    suppressClick.current = false;
    if (locked || event.button !== 0) return;
    event.preventDefault();
    locate(clip.start + (mode === "start" ? range.start : range.end));
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      x: event.clientX,
      original: clip,
      range,
      mode,
      value: clip,
      moved: false,
    });
  };
  const click = (event: React.MouseEvent, time: number) => {
    event.stopPropagation();
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    locate(time);
  };
  const displayed = gesture?.value ?? clip;
  return (
    <div
      className={`clip-animations ${locked ? "locked" : ""} ${gesture?.moved ? "dragging" : ""}`}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerMove={(event) => {
        const drag = live.current;
        if (!drag) return;
        event.stopPropagation();
        const delta = event.clientX - drag.x;
        if (!drag.moved && Math.abs(delta) < 3) return;
        setDrag({
          ...drag,
          moved: true,
          value: retimeAnimation(
            drag.original,
            drag.range,
            drag.mode,
            delta / zoom,
            fps,
          ),
        });
      }}
      onPointerUp={(event) => {
        const drag = live.current;
        if (!drag) return;
        event.stopPropagation();
        suppressClick.current = drag.moved;
        if (!locked && drag.value !== drag.original) commit(drag.value);
        setDrag(null);
      }}
      onPointerCancel={() => setDrag(null)}
      onLostPointerCapture={() => setDrag(null)}
    >
      {animationRanges(displayed).map((range, index) => {
        const start = clip.start + range.start,
          end = clip.start + range.end;
        const width = (range.end - range.start) * zoom;
        const head = range.hasEnd ? Math.min(12, width * 0.4) : 0;
        const active = selected && Math.abs(playhead - end) <= 0.5 / fps;
        return (
          <div
            key={index}
            className="clip-animation"
            data-start={start}
            data-end={end}
            style={{ left: range.start * zoom, width }}
          >
            <button
              type="button"
              className="animation-arrow"
              aria-label={`动画 ${timeLabel(start)} 至 ${timeLabel(end)}`}
              title={`${timeLabel(start)} → ${timeLabel(end)} · 持续 ${timeLabel(end - start)}`}
              onPointerDown={(event) => begin(event, range, "move")}
              onClick={(event) => click(event, end)}
            >
              <svg
                width="100%"
                height="20"
                viewBox={`0 0 ${width} 20`}
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path
                  d={`${range.hasStart ? "M0 10" : "M0 5"} L${width - head} 5 ${range.hasEnd ? `L${width - head} 1 L${width} 10 L${width - head} 19` : `L${width} 15`} L${width - head} 15 ${range.hasStart ? "" : "L0 15"} Z`}
                />
              </svg>
            </button>
            {range.hasStart && (
              <button
                type="button"
                className="animation-point start"
                aria-label={`动画开始 ${timeLabel(start)}`}
                title={`动画开始 ${timeLabel(start)}`}
                onPointerDown={(event) => begin(event, range, "start")}
                onClick={(event) => click(event, start)}
              />
            )}
            {range.hasEnd && (
              <button
                type="button"
                className={`animation-point end ${active ? "active" : ""}`}
                aria-label={`动画结束 ${timeLabel(end)}`}
                title={`动画结束 ${timeLabel(end)}`}
                onPointerDown={(event) => begin(event, range, "end")}
                onClick={(event) => click(event, end)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
