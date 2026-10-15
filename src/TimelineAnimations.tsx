import type { Clip } from "../shared/model";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import {
  snapshotAnimation,
  setAnimationEasing,
} from "../shared/animation-edit";
import { AnimationContextMenu } from "./AnimationContextMenu";
import {
  animationRanges,
  visibleAnimationRanges,
  retimeAnimation,
  type AnimationRange,
  type AnimationDragMode,
} from "../shared/animation-ranges";
import { timeLabel } from "./Preview";
import { animationCursor } from "./animationCursor";

export function TimelineAnimations({
  clip,
  zoom,
  playhead,
  fps,
  selected,
  locate,
  locked,
  commit,
  selectedFrame,
  copy,
  remove,
  viewportStart,
  viewportEnd,
}: {
  clip: Clip;
  zoom: number;
  playhead: number;
  fps: number;
  selected: boolean;
  locate: (time: number, side: "start" | "end") => void;
  locked: boolean;
  commit: (clip: Clip) => void;
  selectedFrame: { time: number; side: "start" | "end" } | null;
  copy: (range: AnimationRange, cut?: boolean) => void;
  remove: (range: AnimationRange) => void;
  viewportStart: number;
  viewportEnd: number;
}) {
  type Gesture = {
    x: number;
    original: Clip;
    range: AnimationRange;
    mode: AnimationDragMode;
    value: Clip;
    moved: boolean;
    index: number;
  };
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const live = useRef<Gesture | null>(null);
  const [context, setContext] = useState<{
    x: number;
    y: number;
    range: AnimationRange;
  } | null>(null);
  const closeContext = useCallback(() => setContext(null), []);
  const suppressClick = useRef(false);
  const points = useRef<HTMLDivElement>(null);
  const pulse = useRef<{ point: HTMLElement; animation: Animation } | null>(
    null,
  );
  const editedEnd =
    selectedFrame?.side === "end"
      ? clip.keyframes.find(
          (frame) => Math.abs(frame.time - selectedFrame.time) < 1e-6,
        )
      : undefined;
  useEffect(() => {
    const point = points.current?.querySelector<HTMLElement>(
      ".animation-point.end.selected-frame",
    );
    if (
      !point ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      pulse.current?.animation.cancel();
      pulse.current = null;
      return;
    }
    // Let a pulse finish during continuous slider changes instead of restarting
    // it every frame. A later change starts a fresh pulse on the same endpoint.
    if (
      pulse.current?.point === point &&
      pulse.current.animation.playState === "running"
    )
      return;
    pulse.current?.animation.cancel();
    const animation = point.animate(
      [
        { transform: getComputedStyle(point).transform },
        { transform: "translate(-50%, -50%) scale(2.25)", offset: 0.45 },
        { transform: "translate(-50%, -50%) scale(1.7)" },
      ],
      { duration: 340, easing: "cubic-bezier(0.22, 0.61, 0.36, 1)" },
    );
    pulse.current = { point, animation };
  }, [
    selectedFrame?.time,
    selectedFrame?.side,
    editedEnd?.value.x,
    editedEnd?.value.y,
    editedEnd?.value.scale,
    editedEnd?.value.opacity,
    editedEnd?.value.rotation,
    editedEnd?.value.rotationX,
    editedEnd?.value.rotationY,
    editedEnd?.value.skew,
    editedEnd?.value.z,
    editedEnd?.value.contentX,
    editedEnd?.value.contentY,
    editedEnd?.value.contentScale,
    editedEnd?.value.cropLeft,
    editedEnd?.value.cropTop,
    editedEnd?.value.cropRight,
    editedEnd?.value.cropBottom,
  ]);
  useEffect(() => () => pulse.current?.animation.cancel(), []);
  const setDrag = (next: Gesture | null) => {
    live.current = next;
    setGesture(next);
  };
  const begin = (
    event: PointerEvent<HTMLButtonElement>,
    range: AnimationRange,
    mode: AnimationDragMode,
    index: number,
  ) => {
    event.stopPropagation();
    suppressClick.current = false;
    if (locked || event.button !== 0) return;
    event.preventDefault();
    locate(
      clip.start + (mode === "start" ? range.start : range.end),
      mode === "start" ? "start" : "end",
    );
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      x: event.clientX,
      original: clip,
      range,
      mode,
      value: clip,
      moved: false,
      index,
    });
  };
  const click = (
    event: React.MouseEvent,
    time: number,
    side: "start" | "end",
  ) => {
    event.stopPropagation();
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    locate(time, side);
  };
  const displayed = gesture?.value ?? clip;
  const ranges = useMemo(() => animationRanges(displayed), [displayed]);
  const visible = useMemo(
    () =>
      visibleAnimationRanges(
        ranges,
        viewportStart - clip.start,
        viewportEnd - clip.start,
        gesture?.index,
      ),
    [ranges, viewportStart, viewportEnd, clip.start, gesture?.index],
  );
  return (
    <>
      <div
        ref={points}
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
          if (!locked && drag.value !== drag.original) {
            commit(drag.value);
            const index = animationRanges(drag.original).findIndex(
              (range) =>
                range.start === drag.range.start &&
                range.end === drag.range.end,
            );
            const range = animationRanges(drag.value)[index];
            if (range)
              locate(
                clip.start + (drag.mode === "start" ? range.start : range.end),
                drag.mode === "start" ? "start" : "end",
              );
          }
          setDrag(null);
        }}
        onPointerCancel={() => setDrag(null)}
        onLostPointerCapture={() => setDrag(null)}
      >
        {visible.map(({ range, index }) => {
          const start = clip.start + range.start,
            end = clip.start + range.end;
          const width = (range.end - range.start) * zoom;
          const head = range.hasEnd ? Math.min(12, width * 0.4) : 0;
          const active = selected && Math.abs(playhead - end) <= 0.5 / fps;
          const startSelected =
            selectedFrame?.side === "start" &&
            Math.abs(
              selectedFrame.time - range.start - (clip.animationOffset ?? 0),
            ) < 1e-6;
          const endSelected =
            selectedFrame?.side === "end" &&
            Math.abs(
              selectedFrame.time - range.end - (clip.animationOffset ?? 0),
            ) < 1e-6;
          return (
            <div
              key={index}
              className={`clip-animation ${startSelected || endSelected ? "selected-animation" : ""}`}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                locate(end, "end");
                setContext({ x: event.clientX, y: event.clientY, range });
              }}
              data-start={start}
              data-end={end}
              style={{ left: range.start * zoom, width }}
            >
              <button
                type="button"
                className="animation-arrow"
                aria-label={`动画 ${timeLabel(start)} 至 ${timeLabel(end)}`}
                title={`${timeLabel(start)} → ${timeLabel(end)} · 持续 ${timeLabel(end - start)}`}
                onPointerDown={(event) => begin(event, range, "move", index)}
                onClick={(event) => click(event, end, "end")}
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
                  className={`animation-point start ${startSelected ? "selected-frame" : ""}`}
                  aria-pressed={startSelected}
                  style={
                    locked ? undefined : { cursor: animationCursor("start") }
                  }
                  aria-label={`动画开始 ${timeLabel(start)}`}
                  title={`动画开始 ${timeLabel(start)}`}
                  onPointerDown={(event) => begin(event, range, "start", index)}
                  onClick={(event) => click(event, start, "start")}
                />
              )}
              {range.hasEnd && (
                <button
                  type="button"
                  className={`animation-point end ${active ? "active" : ""} ${endSelected ? "selected-frame" : ""}`}
                  aria-pressed={endSelected}
                  style={
                    locked ? undefined : { cursor: animationCursor("end") }
                  }
                  aria-label={`动画结束 ${timeLabel(end)}`}
                  title={`动画结束 ${timeLabel(end)}`}
                  onPointerDown={(event) => begin(event, range, "end", index)}
                  onClick={(event) => click(event, end, "end")}
                />
              )}
            </div>
          );
        })}
      </div>
      {context && (
        <AnimationContextMenu
          x={context.x}
          y={context.y}
          locked={locked}
          easing={snapshotAnimation(clip, context.range)?.easing ?? "auto"}
          close={closeContext}
          copy={() => copy(context.range)}
          cut={() => copy(context.range, true)}
          remove={() => remove(context.range)}
          changeEasing={(easing) =>
            commit(setAnimationEasing(clip, context.range, easing))
          }
        />
      )}
    </>
  );
}
