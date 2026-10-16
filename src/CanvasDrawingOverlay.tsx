import { useRef, useState } from "react";
import type { Editor } from "./useEditor";
import { cameraAt } from "../shared/canvas";
import { shapeStyleSchema, type Point } from "../shared/annotation-style";

export default function CanvasDrawingOverlay({ editor }: { editor: Editor }) {
  const points = useRef<Point[]>([]);
  const [draft, setDraft] = useState<Point[]>([]);
  const canvas = editor.project.canvas;
  const camera = cameraAt(editor.project, editor.playhead);
  const settings = editor.penSettings;
  const position = (event: React.PointerEvent<SVGSVGElement>): Point => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x:
        (camera.x +
          ((event.clientX - bounds.left) / bounds.width - 0.5) / camera.scale) *
        canvas.width,
      y:
        (camera.y +
          ((event.clientY - bounds.top) / bounds.height - 0.5) / camera.scale) *
        canvas.height,
    };
  };
  const append = (value: Point) => {
    const last = points.current.at(-1);
    if (last && Math.hypot(value.x - last.x, value.y - last.y) < 1) return;
    if (points.current.length >= 20000) return;
    points.current.push(value);
    setDraft([...points.current]);
  };
  const reset = () => {
    points.current = [];
    setDraft([]);
  };
  return (
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
        }
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        editor.setPlaying(false);
        points.current = [];
        append(position(event));
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          append(position(event));
      }}
      onPointerCancel={reset}
      onPointerUp={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        append(position(event));
        const values = points.current;
        if (values.length > 1) {
          const pad = settings.width / 2 + 1;
          const left = Math.min(...values.map((p) => p.x)) - pad;
          const top = Math.min(...values.map((p) => p.y)) - pad;
          const width = Math.max(
            1,
            Math.max(...values.map((p) => p.x)) - left + pad,
          );
          const height = Math.max(
            1,
            Math.max(...values.map((p) => p.y)) - top + pad,
          );
          editor.addAnnotation(
            {
              kind: "shape",
              shape: "freehand",
              name: "涂鸦",
              size: { width, height },
              style: shapeStyleSchema.parse({
                stroke: settings.color,
                strokeWidth: settings.width,
                fillEnabled: false,
              }),
              drawing: {
                enabled: settings.animate,
                duration: settings.duration,
                delay: 0,
                points: values.map((p) => ({ x: p.x - left, y: p.y - top })),
              },
            },
            editor.playhead,
            undefined,
            {
              x: (left + width / 2) / canvas.width,
              y: (top + height / 2) / canvas.height,
            },
          );
        }
        reset();
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
    >
      <polyline
        points={draft
          .map(
            (p) =>
              `${(p.x - camera.x * canvas.width) * camera.scale + canvas.width / 2},${(p.y - camera.y * canvas.height) * camera.scale + canvas.height / 2}`,
          )
          .join(" ")}
        fill="none"
        stroke={settings.color}
        strokeWidth={settings.width * camera.scale}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
