import { useEffect, useRef, useState } from "react";
import { Diamond, Trash2 } from "lucide-react";
import {
  cameraAt,
  clampCamera,
  resizeHandles,
  resizeTransform,
} from "../shared/canvas";
import type { Transform } from "../shared/model";
import type { Editor } from "./useEditor";
import { ScenePreview, timeLabel } from "./Preview";

export default function ZoomPanPanel({ editor }: { editor: Editor }) {
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
    editor.cameraDraft ?? cameraAt(editor.project, editor.playhead);
  useEffect(() => {
    const element = overview.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      editor.setCameraDraft(null);
    };
  }, [editor.setCameraDraft]);
  const removeFrame = (time: number) =>
    editor.apply((project) => ({
      ...project,
      camera: project.camera && {
        ...project.camera,
        keyframes: project.camera.keyframes.filter(
          (frame) => frame.time !== time,
        ),
      },
    }));
  const numberField = (name: string, key: "x" | "y") => (
    <label className="field">
      {name}
      <input
        type="number"
        min={0}
        max={100}
        step={0.1}
        value={Number((camera[key] * 100).toFixed(1))}
        onChange={(event) => {
          const value = Number(event.target.value);
          if (Number.isFinite(value) && value >= 0 && value <= 100)
            editor.updateCamera({ [key]: value / 100 });
        }}
      />
    </label>
  );
  return (
    <>
      <p className="panel-intro">
        移动播放头，再拖动取景框或调整缩放，自动生成整个画面的运镜关键帧。
      </p>
      <div
        className="zoom-pan-overview"
        ref={overview}
        aria-label="画布取景预览"
        style={{
          aspectRatio: `${editor.project.canvas.width} / ${editor.project.canvas.height}`,
          background: editor.project.canvas.background,
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
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
            time: editor.playhead,
            original: value,
            value,
            handle,
          };
          editor.setCameraDraft(value);
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
          editor.setCameraDraft(value);
        }}
        onPointerUp={() => {
          if (drag.current)
            editor.updateCamera(drag.current.value, drag.current.time);
          drag.current = null;
          editor.setCameraDraft(null);
        }}
        onPointerCancel={() => {
          drag.current = null;
          editor.setCameraDraft(null);
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
          onClick={() => editor.updateCamera({ x: 0.5, y: 0.5, scale: 1 })}
        >
          全画面
        </button>
        <button
          disabled={!editor.project.camera}
          onClick={() =>
            editor.apply((project) => ({ ...project, camera: undefined }))
          }
        >
          清除运镜
        </button>
      </div>
      <label className="field camera-zoom-field">
        缩放
        <input
          aria-label="画布缩放"
          type="range"
          min={100}
          max={800}
          step={1}
          value={Math.round(camera.scale * 100)}
          onChange={(event) =>
            editor.updateCamera({ scale: Number(event.target.value) / 100 })
          }
        />
        <input
          aria-label="画布缩放百分比"
          type="number"
          min={100}
          max={800}
          step={1}
          value={Number((camera.scale * 100).toFixed(1))}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value) && value >= 100 && value <= 800)
              editor.updateCamera({ scale: value / 100 });
          }}
        />
        <span>%</span>
      </label>
      {numberField("取景中心 X (%)", "x")}
      {numberField("取景中心 Y (%)", "y")}
      <h3 className="section-title">
        运镜关键帧{" "}
        <span className="auto-badge">
          <Diamond size={10} />
          自动记录
        </span>
      </h3>
      <button className="wide-button" onClick={() => editor.updateCamera({})}>
        <Diamond size={13} />
        添加当前位置关键帧
      </button>
      <div className="keyframe-list camera-keyframe-list">
        {editor.project.camera?.keyframes.map((frame) => (
          <div key={frame.time}>
            <button
              onClick={() => {
                editor.setPlaying(false);
                editor.seek(frame.time);
              }}
            >
              <Diamond size={12} fill="currentColor" />
              {timeLabel(frame.time)} · {Math.round(frame.value.scale * 100)}%
            </button>
            <button
              title="删除运镜关键帧"
              onClick={() => removeFrame(frame.time)}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
