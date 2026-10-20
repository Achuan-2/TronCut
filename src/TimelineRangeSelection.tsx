import { useEffect, useRef, type MouseEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { useEditorPlayhead, type Editor } from "./useEditor";
import { timeLabel } from "./Preview";
import type { TimelineRange } from "../shared/timeline-range";
import "./TimelineRangeSelection.css";

type Part = "start" | "end" | "playhead";
export function TimelineRangeHandles({
  editor,
  zoom,
  maxTime,
  handleContainer,
  onRevealTime,
}: {
  editor: Editor;
  zoom: number;
  maxTime: number;
  handleContainer: HTMLElement | null;
  onRevealTime: (time: number) => void;
}) {
  const playhead = useEditorPlayhead(editor);
  const minTime = editor.timelineBounds?.start ?? 0;
  maxTime = editor.timelineBounds?.end ?? maxTime;
  const range = editor.timelineRange ?? { start: playhead, end: playhead };
  const drag = useRef<{
    pointerId: number;
    part: Part;
    range: TimelineRange;
    x: number;
    time: number;
    latestTime: number;
  } | null>(null);
  const animationFrame = useRef<number | null>(null);
  const cancelFrame = () => {
    if (animationFrame.current !== null) {
      cancelAnimationFrame(animationFrame.current);
      animationFrame.current = null;
    }
  };
  useEffect(
    () => () => {
      cancelFrame();
      drag.current = null;
    },
    [editor.project.id, editor.activeGroupId],
  );
  const update = (
    part: Part,
    time: number,
    anchor: TimelineRange,
    snapToFrame = true,
  ) => {
    const position = Math.max(
      minTime,
      Math.min(
        maxTime,
        snapToFrame
          ? Math.round(time * editor.project.canvas.fps) /
              editor.project.canvas.fps
          : time,
      ),
    );
    if (part === "playhead") editor.seek(position);
    else {
      const next =
        part === "start"
          ? { start: Math.min(position, anchor.end), end: anchor.end }
          : { start: anchor.start, end: Math.max(position, anchor.start) };
      editor.setTimelineRange(next);
      editor.seek(part === "start" ? next.start : next.end);
      return next[part];
    }
    return position;
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.stopPropagation();
    active.latestTime = active.time + (event.clientX - active.x) / zoom;
    if (animationFrame.current !== null) return;
    animationFrame.current = requestAnimationFrame(() => {
      animationFrame.current = null;
      const latest = drag.current;
      if (latest)
        update(
          latest.part,
          latest.latestTime,
          latest.range,
          latest.part !== "playhead",
        );
    });
  };
  const finish = (event: PointerEvent<HTMLButtonElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.stopPropagation();
    cancelFrame();
    // Keep the last movement even if pointer-up precedes the queued frame.
    // The cursor follows pixels while dragging and lands on a video frame.
    update(active.part, active.latestTime, active.range);
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
        latestTime: part === "playhead" ? playhead : range[part],
      };
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: move,
    onPointerUp: finish,
    onPointerCancel: finish,
    onLostPointerCapture: finish,
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
      {/* Keep handles together, outside the scroll pane's left clipping edge. */}
      {handleContainer &&
        createPortal(
          <div
            className="ruler-playhead"
            style={{ transform: `translateX(${playhead * zoom}px)` }}
          >
            {(["start", "end"] as const).map((part) => {
              // Each endpoint folds independently when it meets the playhead.
              const collapsed = Math.abs(range[part] - playhead) * zoom < 0.5;
              return (
                <button
                  key={part}
                  role="slider"
                  aria-label={part === "start" ? "范围起点" : "范围终点"}
                  aria-valuemin={minTime}
                  aria-valuemax={maxTime}
                  aria-valuenow={range[part]}
                  aria-valuetext={timeLabel(range[part])}
                  title={`${part === "start" ? "起点" : "终点"} ${timeLabel(range[part])} · 拖动选择范围`}
                  className={`timeline-range-handle ${part} ${collapsed ? "collapsed" : "expanded"}`}
                  style={{
                    left: (range[part] - playhead) * zoom,
                  }}
                  {...pointerProps(part)}
                  onKeyDown={(event) => {
                    if (
                      !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                        event.key,
                      )
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
                        ? minTime
                        : event.key === "End"
                          ? maxTime
                          : range[part] +
                            (event.key === "ArrowLeft" ? -step : step);
                    onRevealTime(update(part, time, range));
                  }}
                >
                  <span />
                </button>
              );
            })}
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
          </div>,
          handleContainer,
        )}
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
