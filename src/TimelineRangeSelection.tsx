import { useRef, type MouseEvent, type PointerEvent } from "react";
import { useEditorPlayhead, type Editor } from "./useEditor";
import { timeLabel } from "./Preview";
import type { TimelineRange } from "../shared/timeline-range";
import "./TimelineRangeSelection.css";

type Part = "start" | "end" | "playhead";
export function TimelineRangeHandles({
  editor,
  zoom,
  maxTime,
}: {
  editor: Editor;
  zoom: number;
  maxTime: number;
}) {
  const playhead = useEditorPlayhead(editor);
  const range = editor.timelineRange ?? { start: playhead, end: playhead };
  const drag = useRef<{
    pointerId: number;
    part: Part;
    range: TimelineRange;
    x: number;
    time: number;
  } | null>(null);
  const update = (part: Part, time: number, anchor: TimelineRange) => {
    const frame = Math.max(
      0,
      Math.min(
        maxTime,
        Math.round(time * editor.project.canvas.fps) /
          editor.project.canvas.fps,
      ),
    );
    if (part === "playhead") editor.seek(frame);
    else {
      const next =
        part === "start"
          ? { start: Math.min(frame, anchor.end), end: anchor.end }
          : { start: anchor.start, end: Math.max(frame, anchor.start) };
      editor.setTimelineRange(next);
      editor.seek(part === "start" ? next.start : next.end);
    }
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.stopPropagation();
    update(
      active.part,
      active.time + (event.clientX - active.x) / zoom,
      active.range,
    );
  };
  const finish = (event: PointerEvent<HTMLButtonElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const pointerProps = (part: Part) => ({
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      editor.setPlaying(false);
      editor.select(null);
      drag.current = {
        part,
        pointerId: event.pointerId,
        range: { ...range },
        x: event.clientX,
        time: part === "playhead" ? playhead : range[part],
      };
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: move,
    onPointerUp: finish,
    onPointerCancel: finish,
    onLostPointerCapture: () => {
      drag.current = null;
    },
    onClick: (event: MouseEvent) => event.stopPropagation(),
  });
  return (
    <>
      {editor.timelineRange && (
        <div
          className="ruler-range-highlight"
          style={{
            left: range.start * zoom,
            width: (range.end - range.start) * zoom,
          }}
        />
      )}
      {(["start", "end"] as const).map((part) => {
        // Each endpoint folds independently when it meets the playhead.
        const collapsed = Math.abs(range[part] - playhead) * zoom < 0.5;
        return (
          <button
            key={part}
            role="slider"
            aria-label={part === "start" ? "范围起点" : "范围终点"}
            aria-valuemin={0}
            aria-valuemax={maxTime}
            aria-valuenow={range[part]}
            aria-valuetext={timeLabel(range[part])}
            title={`${part === "start" ? "起点" : "终点"} ${timeLabel(range[part])} · 拖动选择范围`}
            className={`timeline-range-handle ${part} ${collapsed ? "collapsed" : "expanded"}`}
            style={{
              left:
                part === "start"
                  ? Math.max(collapsed ? 24 : 17, range.start * zoom)
                  : range.end * zoom +
                    (collapsed && playhead * zoom < 24 ? 17 : 0),
            }}
            {...pointerProps(part)}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              event.stopPropagation();
              editor.setPlaying(false);
              editor.select(null);
              const step =
                (event.shiftKey ? 10 : 1) / editor.project.canvas.fps;
              const time =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? maxTime
                    : range[part] + (event.key === "ArrowLeft" ? -step : step);
              update(part, time, range);
            }}
          >
            <span />
          </button>
        );
      })}
      <div
        className="ruler-playhead"
        style={{ transform: `translateX(${playhead * zoom}px)` }}
      >
        <button
          aria-label="播放头"
          title="拖动定位；双击收起范围"
          className="timeline-playhead-handle"
          {...pointerProps("playhead")}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            editor.setTimelineRange(null);
          }}
        />
      </div>
    </>
  );
}

export function TimelineRangeOverlay({
  editor,
  zoom,
}: {
  editor: Editor;
  zoom: number;
}) {
  const range = editor.timelineRange;
  return range ? (
    <div
      className="timeline-range-overlay"
      aria-label="已选时间范围"
      data-start={range.start}
      data-end={range.end}
      style={{
        left: range.start * zoom,
        width: (range.end - range.start) * zoom,
      }}
    />
  ) : null;
}
