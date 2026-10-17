import { useRef, useState } from "react";
import type { Editor } from "./useEditor";
import { cameraAt } from "../shared/canvas";
import {
  annotationSvgBody,
  shapeStyleSchema,
  type Point,
  type ShapeStyle,
} from "../shared/annotation-style";

export default function CanvasDrawingOverlay({ editor }: { editor: Editor }) {
  const points = useRef<Point[]>([]);
  const ink = useRef<ShapeStyle>(shapeStyleSchema.parse({}));
  const [draft, setDraft] = useState<Point[]>([]);
  const canvas = editor.project.canvas;
  const camera = cameraAt(editor.project, editor.playhead);
  const settings = editor.penSettings;
  const usedPoints = editor.penDraft.reduce(
    (sum, stroke) => sum + stroke.points.length,
    0,
  );
  const position = (event: React.PointerEvent<SVGSVGElement>): Point => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(
          canvas.width,
          (camera.x +
            ((event.clientX - bounds.left) / bounds.width - 0.5) /
              camera.scale) *
            canvas.width,
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          canvas.height,
          (camera.y +
            ((event.clientY - bounds.top) / bounds.height - 0.5) /
              camera.scale) *
            canvas.height,
        ),
      ),
    };
  };
  const append = (value: Point) => {
    const last = points.current.at(-1);
    if (last && Math.hypot(value.x - last.x, value.y - last.y) < 1) return;
    if (usedPoints + points.current.length >= 20000) return;
    points.current.push(value);
    setDraft([...points.current]);
  };
  const reset = () => {
    points.current = [];
    setDraft([]);
  };
  const strokes = [
    ...editor.penDraft,
    ...(draft.length > 1 ? [{ points: draft, style: ink.current }] : []),
  ];
  return (
    <>
      <svg
        className="canvas-drawing-overlay"
        aria-label="涂鸦绘制画布"
        tabIndex={0}
        viewBox={`0 0 ${canvas.width} ${canvas.height}`}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            reset();
            editor.setCanvasMode("select");
          } else if (event.key === "Enter" && !draft.length) {
            event.preventDefault();
            event.stopPropagation();
            editor.finishDrawing();
          } else if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === "z"
          ) {
            event.preventDefault();
            event.stopPropagation();
            reset();
            editor.setPenDraft((strokes) => strokes.slice(0, -1));
          }
        }}
        onPointerDown={(event) => {
          if (
            event.button !== 0 ||
            !event.isPrimary ||
            usedPoints >= 19998 ||
            editor.penDraft.length >= 1000
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          editor.setPlaying(false);
          ink.current = shapeStyleSchema.parse({
            stroke: settings.color,
            strokeWidth: settings.width,
            brush: settings.brush,
            fillEnabled: false,
          });
          points.current = [];
          append(position(event));
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            append(position(event));
        }}
        onPointerCancel={reset}
        onLostPointerCapture={reset}
        onPointerUp={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          event.stopPropagation();
          append(position(event));
          if (points.current.length === 1) {
            const p = points.current[0];
            points.current.push({
              x: p.x + (p.x < canvas.width ? 0.01 : -0.01),
              y: p.y,
            });
          }
          if (points.current.length > 1)
            editor.addPenStroke({
              points: [...points.current],
              style: ink.current,
            });
          reset();
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
      >
        <g
          transform={`translate(${canvas.width / 2 - camera.x * canvas.width * camera.scale},${canvas.height / 2 - camera.y * canvas.height * camera.scale}) scale(${camera.scale})`}
          dangerouslySetInnerHTML={{
            __html: strokes.length
              ? annotationSvgBody({
                  shape: "freehand",
                  drawing: { enabled: false, duration: 1, delay: 0, strokes },
                })
              : "",
          }}
        />
      </svg>
      <div
        className="canvas-drawing-actions"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <span>已绘制 {editor.penDraft.length} 笔</span>
        <button
          disabled={!editor.penDraft.length || !!draft.length}
          onClick={() => editor.setPenDraft((strokes) => strokes.slice(0, -1))}
        >
          撤销上一笔
        </button>
        <button onClick={() => editor.setCanvasMode("select")}>取消绘制</button>
        <button
          className="primary"
          disabled={!editor.penDraft.length || !!draft.length}
          onClick={editor.finishDrawing}
        >
          完成绘制
        </button>
      </div>
    </>
  );
}
