import { useEffect, useRef, useState } from "react";
import { cameraAt, clampCamera, resizeHandles, resizeTransform } from "../shared/canvas";
import { projectDuration, type Transform } from "../shared/model";
import { useEditorPlayhead, type Editor } from "./useEditor";
import { ScenePreview } from "./Preview";
import NumberInput from "./NumberInput";

export default function ZoomPanPanel({ editor }: { editor: Editor }) {
  const playhead = useEditorPlayhead(editor);
  const overview = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(240);
  const drag = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
    time: number;
    original: Transform;
    value: Transform;
    handle?: { x: number; y: number };
  } | null>(null);
  const camera =
    editor.zoomPanDraft ?? cameraAt(editor.project, playhead);
  const available = !editor.timelineBounds && projectDuration(editor.project) > 0;
  useEffect(() => {
    const element = overview.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      editor.setZoomPanDraft(null);
    };
  }, [editor.setZoomPanDraft]);
  if (editor.timelineBounds)
    return <p className="panel-intro">请返回主时间轴编辑全局画布运镜。</p>;
  return (
    <>
      <p className="panel-intro">
        缩放和平移当前合成画面，画布的显示比例和位置保持不变。
      </p>
      <button disabled={!available} onClick={editor.addCanvasZoomPan}>添加画布缩放与平移</button>
      <div
        className="zoom-pan-overview"
        ref={overview}
        aria-label="画布取景预览"
        style={{
          aspectRatio: `${editor.project.canvas.width} / ${editor.project.canvas.height}`,
          background: editor.project.canvas.background,
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || !available) return;
          event.preventDefault();
          event.stopPropagation();
          editor.setPlaying(false);
          if (editor.editingTextId) editor.endTextEdit(editor.editingTextId);
          const bounds = event.currentTarget.getBoundingClientRect();
          const target = event.target as HTMLElement;
          const handle = resizeHandles.find(
            (handle) =>
              handle.name ===
              target.closest<HTMLElement>("[data-camera-handle]")?.dataset
                .cameraHandle,
          );
          const value = target.closest(".camera-viewport")
            ? camera
            : clampCamera({
                ...camera,
                x: (event.clientX - bounds.left) / bounds.width,
                y: (event.clientY - bounds.top) / bounds.height,
              });
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            width: bounds.width,
            height: bounds.height,
            time: playhead,
            original: value,
            value,
            handle,
          };
          editor.setZoomPanDraft(value);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current) return;
          const dx = (event.clientX - current.x) / current.width,
            dy = (event.clientY - current.y) / current.height;
          let value: Transform;
          if (current.handle) {
            const resized = resizeTransform(
              { ...current.original, scale: 1 / current.original.scale },
              {
                x: dx * editor.project.canvas.width,
                y: dy * editor.project.canvas.height,
              },
              current.handle,
              editor.project.canvas,
              editor.project.canvas,
            );
            value = clampCamera({ ...resized, scale: 1 / resized.scale });
          } else
            value = clampCamera({
              ...current.original,
              x: current.original.x + dx,
              y: current.original.y + dy,
            });
          current.value = value;
          editor.setZoomPanDraft(value);
        }}
        onPointerUp={() => {
          if (drag.current)
            editor.updateCanvasZoomPan(drag.current.value, drag.current.time);
          drag.current = null;
          editor.setZoomPanDraft(null);
        }}
        onPointerCancel={() => {
          drag.current = null;
          editor.setZoomPanDraft(null);
        }}
      >
        <ScenePreview
          editor={editor}
          scale={width / editor.project.canvas.width}
          interactive={false}
          applyCamera={false}
        />
        <div
          className="camera-viewport"
          aria-label="拖动平移取景框"
          style={{
            left: `${(camera.x - 0.5 / camera.scale) * 100}%`,
            top: `${(camera.y - 0.5 / camera.scale) * 100}%`,
            width: `${100 / camera.scale}%`,
            height: `${100 / camera.scale}%`,
          }}
        >
          {resizeHandles
            .filter((handle) => handle.x && handle.y)
            .map((handle) => (
              <span
                key={handle.name}
                data-camera-handle={handle.name}
                className={`camera-handle ${handle.name}`}
                style={{
                  left: `${(handle.x + 1) * 50}%`,
                  top: `${(handle.y + 1) * 50}%`,
                }}
              />
            ))}
        </div>
      </div>
      <div className="two-buttons">
        <button
          disabled={!available}
          onClick={() =>
            editor.updateCanvasZoomPan({ x: 0.5, y: 0.5, scale: 1 })
          }
        >
          全画面
        </button>
        <button
          disabled={!editor.project.camera}
          onClick={() => editor.apply(project => ({ ...project, camera: undefined }))}
        >
          清除运镜
        </button>
      </div>
      <label className="field camera-zoom-field">
        缩放
        <input
          aria-label="画布缩放"
          disabled={!available}
          type="range"
          min={100}
          max={800}
          step={1}
          value={Math.round(camera.scale * 100)}
          onChange={(event) =>
            editor.updateCanvasZoomPan({
              scale: Number(event.target.value) / 100,
            })
          }
        />
        <NumberInput
          aria-label="画布缩放百分比"
          disabled={!available}
          min={100}
          max={800}
          step={1}
          value={Number((camera.scale * 100).toFixed(1))}
          onValueChange={(value) =>
            editor.updateCanvasZoomPan({ scale: value / 100 })
          }
        />
        <span>%</span>
      </label>
    </>
  );
}
