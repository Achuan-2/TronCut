import { useRef, useState } from "react";
import type { Editor } from "./useEditor";
import { cameraAt } from "../shared/canvas";
import type { Point } from "../shared/annotation-style";
import {
  maxPolygonPoints,
  polygonCanvasPoint,
  polygonToCanvas,
  movePenAnchor,
  adjustPenHandle,
  smoothPenAnchor,
  insertPenAnchor,
} from "../shared/polygon";
import {
  penPathData,
  penSegmentData,
  penSegments,
  type BezierAnchor,
} from "../shared/bezier";

type Gesture = {
  pointerId: number;
  kind: "new" | "anchor" | "handle" | "close" | "segment" | "finish";
  index: number;
  side?: "in" | "out";
  start: Point;
  before: BezierAnchor[];
  changed: boolean;
  alt: boolean;
  control: boolean;
  ratio?: number;
};

const copyAnchors = (anchors: readonly BezierAnchor[]) =>
  anchors.map((anchor) => ({
    ...anchor,
    in: anchor.in ? { ...anchor.in } : undefined,
    out: anchor.out ? { ...anchor.out } : undefined,
  }));

export default function CanvasPolygonOverlay({ editor }: { editor: Editor }) {
  const target = editor.polygonTargetId
    ? editor.project.clips.find((clip) => clip.id === editor.polygonTargetId)
    : undefined;
  const editing = !!target;
  const canvas = editor.project.canvas;
  const camera = cameraAt(editor.project, editor.playhead);
  const [anchors, setAnchors] = useState<BezierAnchor[]>(() =>
    target
      ? polygonToCanvas(
          target,
          canvas,
          Math.max(
            0,
            Math.min(target.duration, editor.playhead - target.start),
          ),
        )
      : [],
  );
  const anchorsRef = useRef(anchors);
  const gesture = useRef<Gesture | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const past = useRef<BezierAnchor[][]>([]);
  const future = useRef<BezierAnchor[][]>([]);
  const startTime = useRef<number | null>(null);
  const [selected, setSelected] = useState<number | null>(
    anchors.length ? 0 : null,
  );
  const [hover, setHover] = useState<Point | null>(null);
  const [error, setError] = useState("");
  const [markerRadius, setMarkerRadius] = useState(8);
  const [historyVersion, setHistoryVersion] = useState(0);
  const apply = (next: BezierAnchor[]) => {
    anchorsRef.current = next;
    setAnchors(next);
  };
  const record = (before: BezierAnchor[]) => {
    past.current.push(before);
    if (past.current.length > 100) past.current.shift();
    future.current = [];
    setHistoryVersion((value) => value + 1);
  };
  const position = (event: React.PointerEvent<Element>) => {
    const bounds = svg.current!.getBoundingClientRect();
    setMarkerRadius((6 * canvas.width) / (bounds.width * camera.scale));
    return polygonCanvasPoint(
      {
        x: (event.clientX - bounds.left) / bounds.width,
        y: (event.clientY - bounds.top) / bounds.height,
      },
      canvas,
      camera,
    );
  };
  const finish = () => {
    if (
      !editor.finishPolygon(
        anchorsRef.current,
        startTime.current ?? editor.playhead,
      )
    )
      setError("请绘制至少 3 个顶点且面积不为零的形状");
  };
  const undo = () => {
    const previous = past.current.pop();
    if (!previous || gesture.current) {
      if (previous) past.current.push(previous);
      return;
    }
    future.current.push(copyAnchors(anchorsRef.current));
    apply(copyAnchors(previous));
    if (!anchorsRef.current.length) startTime.current = null;
    setSelected(null);
    setHistoryVersion((value) => value + 1);
  };
  const redo = () => {
    const next = future.current.pop();
    if (!next || gesture.current) {
      if (next) future.current.push(next);
      return;
    }
    past.current.push(copyAnchors(anchorsRef.current));
    apply(copyAnchors(next));
    if (!anchorsRef.current.length) startTime.current = null;
    setSelected(null);
    setHistoryVersion((value) => value + 1);
  };
  const removeSelected = () => {
    if (
      selected === null ||
      (editing && anchorsRef.current.length <= 3) ||
      !anchorsRef.current[selected]
    )
      return;
    record(copyAnchors(anchorsRef.current));
    const next = anchorsRef.current.filter((_, index) => index !== selected);
    apply(next);
    if (!next.length) startTime.current = null;
    setSelected(null);
  };
  const cancel = () => {
    gesture.current = null;
    apply([]);
    setHover(null);
    startTime.current = null;
    editor.setCanvasMode("select");
  };
  const begin = (
    event: React.PointerEvent<Element>,
    value: Omit<Gesture, "pointerId" | "start" | "before">,
  ) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.stopPropagation();
    const point = position(event);
    svg.current?.focus();
    svg.current?.setPointerCapture(event.pointerId);
    editor.setPlaying(false);
    gesture.current = {
      ...value,
      pointerId: event.pointerId,
      start: point,
      before: copyAnchors(anchorsRef.current),
    };
  };
  const onKeyDown = (
    event: React.KeyboardEvent<SVGSVGElement | HTMLDivElement>,
  ) => {
    event.stopPropagation();
    if (event.key === "Enter" && event.target instanceof HTMLButtonElement)
      return;
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    } else if (event.key === "Enter") {
      event.preventDefault();
      finish();
    } else if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === "z"
    ) {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      removeSelected();
    }
  };
  const transform = `translate(${canvas.width / 2 - camera.x * canvas.width * camera.scale},${canvas.height / 2 - camera.y * canvas.height * camera.scale}) scale(${camera.scale})`;
  const draft =
    !editing && !gesture.current && hover && anchors.length
      ? [...anchors, { x: hover.x, y: hover.y }]
      : anchors;
  const selectedAnchor = selected === null ? undefined : anchors[selected];
  void historyVersion;
  return (
    <>
      <svg
        ref={svg}
        className="canvas-drawing-overlay canvas-polygon-overlay"
        aria-label="钢笔绘制画布"
        tabIndex={0}
        viewBox={`0 0 ${canvas.width} ${canvas.height}`}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary) return;
          if (editing) {
            setSelected(null);
            return;
          }
          if (event.detail > 1) {
            begin(event, {
              kind: "finish",
              index: -1,
              changed: false,
              alt: false,
              control: false,
            });
            return;
          }
          if (anchorsRef.current.length >= maxPolygonPoints) {
            setError(`最多可添加 ${maxPolygonPoints} 个顶点，请完成形状`);
            return;
          }
          const point = position(event);
          const index = anchorsRef.current.length;
          begin(event, {
            kind: "new",
            index,
            changed: true,
            alt: false,
            control: false,
          });
          startTime.current ??= editor.playhead;
          apply([...anchorsRef.current, { x: point.x, y: point.y }]);
          setSelected(index);
          setError("");
        }}
        onPointerMove={(event) => {
          event.stopPropagation();
          const point = position(event);
          setHover(point);
          const current = gesture.current;
          if (!current || current.pointerId !== event.pointerId) return;
          const moved =
              Math.hypot(point.x - current.start.x, point.y - current.start.y) >
              0.5,
            index = current.index;
          if (!moved) return;
          if (current.kind === "new" || current.kind === "close") {
            apply(smoothPenAnchor(anchorsRef.current, index, point));
            current.changed = true;
          } else if (current.kind === "anchor" && current.alt) {
            apply(smoothPenAnchor(anchorsRef.current, index, point));
            current.changed = true;
          } else if (current.kind === "anchor" && current.control) {
            apply(movePenAnchor(anchorsRef.current, index, point));
            current.changed = true;
          } else if (current.kind === "handle" && current.side) {
            apply(
              adjustPenHandle(
                anchorsRef.current,
                index,
                current.side,
                point,
                event.altKey,
              ),
            );
            current.changed = true;
          }
        }}
        onPointerUp={(event) => {
          const current = gesture.current;
          if (!current || current.pointerId !== event.pointerId) return;
          event.stopPropagation();
          gesture.current = null;
          if (svg.current?.hasPointerCapture(event.pointerId))
            svg.current.releasePointerCapture(event.pointerId);
          if (current.kind === "finish" || current.kind === "close") {
            if (current.changed) record(current.before);
            finish();
            return;
          }
          if (current.kind === "segment") {
            if (anchorsRef.current.length >= maxPolygonPoints) {
              setError(`最多可添加 ${maxPolygonPoints} 个顶点`);
              return;
            }
            const next = insertPenAnchor(
              anchorsRef.current,
              current.index,
              current.ratio ?? 0.5,
              editing,
            );
            record(current.before);
            apply(next);
            setSelected(current.index + 1);
            return;
          }
          if (current.kind === "anchor" && current.alt && !current.changed) {
            const next = copyAnchors(anchorsRef.current),
              anchor = next[current.index];
            delete anchor.in;
            delete anchor.out;
            delete anchor.handleMode;
            record(current.before);
            apply(next);
            return;
          }
          if (current.changed) record(current.before);
        }}
        onPointerCancel={(event) => {
          const current = gesture.current;
          if (!current || current.pointerId !== event.pointerId) return;
          apply(current.before);
          gesture.current = null;
        }}
        onLostPointerCapture={() => {
          const current = gesture.current;
          if (!current) return;
          apply(current.before);
          gesture.current = null;
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          finish();
        }}
      >
        <g transform={transform}>
          <path
            className="canvas-polygon-draft"
            d={penPathData(draft, editing)}
            fill={editing ? "#00b5ef44" : "none"}
            stroke="#00b5ef"
            strokeWidth={markerRadius / 3}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {penSegments(anchors, editing).map((segment, index) => (
            <path
              key={index}
              className="canvas-polygon-segment-hit"
              data-segment-index={index}
              d={penSegmentData(segment)}
              strokeWidth={markerRadius * 2}
              onPointerDown={(event) => {
                const point = position(event),
                  path = event.currentTarget,
                  length = path.getTotalLength();
                let ratio = 0,
                  nearest = Infinity;
                for (let step = 0; step <= 60; step++) {
                  const at = (step / 60) * length,
                    sample = path.getPointAtLength(at),
                    distance = Math.hypot(
                      sample.x - point.x,
                      sample.y - point.y,
                    );
                  if (distance < nearest) {
                    nearest = distance;
                    ratio = step / 60;
                  }
                }
                begin(event, {
                  kind: "segment",
                  index,
                  changed: true,
                  alt: false,
                  control: false,
                  ratio,
                });
              }}
            />
          ))}
          {selectedAnchor &&
            (["in", "out"] as const).flatMap((side) => {
              const handle = selectedAnchor[side];
              if (!handle) return [];
              return [
                <line
                  key={`${side}-line`}
                  className="canvas-polygon-handle-line"
                  x1={selectedAnchor.x}
                  y1={selectedAnchor.y}
                  x2={handle.x}
                  y2={handle.y}
                  strokeWidth={markerRadius / 4}
                />,
                <circle
                  key={side}
                  className="canvas-polygon-handle"
                  data-anchor-index={selected}
                  data-handle={side}
                  cx={handle.x}
                  cy={handle.y}
                  r={markerRadius * 0.8}
                  onPointerDown={(event) => {
                    setSelected(selected);
                    begin(event, {
                      kind: "handle",
                      index: selected!,
                      side,
                      changed: false,
                      alt: event.altKey,
                      control: event.ctrlKey || event.metaKey,
                    });
                  }}
                />,
              ];
            })}
          {anchors.map((anchor, index) => (
            <g key={index}>
              {index === 0 && (
                <circle
                  className="canvas-polygon-start"
                  cx={anchor.x}
                  cy={anchor.y}
                  r={markerRadius * (!editing && anchors.length >= 3 ? 1.5 : 1)}
                />
              )}
              <rect
                className={`canvas-polygon-vertex${selected === index ? " selected" : ""}`}
                data-anchor-index={index}
                x={anchor.x - markerRadius * 0.75}
                y={anchor.y - markerRadius * 0.75}
                width={markerRadius * 1.5}
                height={markerRadius * 1.5}
                rx={anchor.in || anchor.out ? markerRadius * 0.35 : 0}
                onPointerDown={(event) => {
                  setSelected(index);
                  const closing =
                    index === 0 &&
                    !editing &&
                    anchorsRef.current.length >= 3 &&
                    !event.altKey &&
                    !event.ctrlKey &&
                    !event.metaKey;
                  begin(event, {
                    kind: closing ? "close" : "anchor",
                    index,
                    changed: false,
                    alt: event.altKey,
                    control: event.ctrlKey || event.metaKey,
                  });
                }}
              />
            </g>
          ))}
        </g>
      </svg>
      <div
        className="canvas-drawing-actions"
        onKeyDown={onKeyDown}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <span
          className={error ? "canvas-polygon-error" : undefined}
          role="status"
        >
          {error || `${editing ? "编辑" : "已添加"} ${anchors.length} 个顶点`}
        </span>
        <button disabled={!past.current.length} onClick={undo}>
          撤销
        </button>
        <button disabled={!future.current.length} onClick={redo}>
          重做
        </button>
        <button
          disabled={selected === null || (editing && anchors.length <= 3)}
          onClick={removeSelected}
        >
          删除锚点
        </button>
        <button onClick={cancel}>取消绘制</button>
        <button
          className="primary"
          disabled={anchors.length < 3}
          onClick={finish}
        >
          完成形状
        </button>
      </div>
    </>
  );
}
