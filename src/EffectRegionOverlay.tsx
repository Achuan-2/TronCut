import { useRef, useState } from "react";
import { Move } from "lucide-react";
import type { Transform } from "../shared/model";
import type { Region } from "../shared/visual-effects";
import { localDelta } from "../shared/rotation";
import { resizeHandles } from "../shared/canvas";
import { selectionControlScale } from "./CanvasSelection";

type Geometry = Pick<Region, "x" | "y" | "width" | "height">;
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export default function EffectRegionOverlay({
  name,
  region,
  width,
  height,
  pose,
  cameraScale,
  canvasScale = 1,
  moveHandleOnly = false,
  showMoveHandle = true,
  onSelect,
  onDraft,
  onCommit,
}: {
  name: string;
  region: Region | Omit<Region, "opacity">;
  width: number;
  height: number;
  pose: Transform;
  cameraScale: number;
  canvasScale?: number;
  moveHandleOnly?: boolean;
  showMoveHandle?: boolean;
  onSelect?: () => void;
  onDraft: (geometry: Geometry | null) => void;
  onCommit: (geometry: Geometry) => void;
}) {
  const gesture = useRef<{
    x: number;
    y: number;
    handle?: { x: number; y: number };
    original: Geometry;
    value: Geometry;
  } | null>(null);
  const [draft, setDraft] = useState<Geometry | null>(null);
  const value = draft ?? region;
  const cancel = () => {
    gesture.current = null;
    setDraft(null);
    onDraft(null);
  };
  return (
    <div
      className={`effect-region-outline${moveHandleOnly ? " handle-move-only" : ""}`}
      data-region-move-only={moveHandleOnly || undefined}
      role="group"
      tabIndex={0}
      aria-label={`${name}编辑区域`}
      style={{
        left: `${value.x * 100}%`,
        top: `${value.y * 100}%`,
        width: `${value.width * 100}%`,
        height: `${value.height * 100}%`,
        borderRadius:
          region.shape === "ellipse" ? "50%" : region.radius * canvasScale,
        transform: `translate(-50%, -50%) rotate(${region.rotation}deg)`,
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const control = (event.target as Element).closest<HTMLElement>(
          "[data-region-handle], [data-region-move]",
        );
        // Let the material distinguish a region-body click from a material drag.
        if (moveHandleOnly && !control) return;
        onSelect?.();
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        const original = {
          x: region.x,
          y: region.y,
          width: region.width,
          height: region.height,
        };
        gesture.current = {
          x: event.clientX,
          y: event.clientY,
          handle: resizeHandles.find(
            (handle) => handle.name === control?.dataset.regionHandle,
          ),
          original,
          value: original,
        };
      }}
      onPointerMove={(event) => {
        const drag = gesture.current;
        if (!drag) return;
        event.stopPropagation();
        let delta = localDelta(pose, {
          x: (event.clientX - drag.x) / (pose.scale * cameraScale),
          y: (event.clientY - drag.y) / (pose.scale * cameraScale),
        });
        if (drag.handle) {
          const angle = (-region.rotation * Math.PI) / 180;
          delta = {
            x: delta.x * Math.cos(angle) - delta.y * Math.sin(angle),
            y: delta.x * Math.sin(angle) + delta.y * Math.cos(angle),
          };
        }
        if (drag.handle) {
          const nextWidth = clamp(
            drag.original.width + (drag.handle.x * delta.x) / width,
            0.01,
            3,
          );
          const nextHeight = clamp(
            drag.original.height + (drag.handle.y * delta.y) / height,
            0.01,
            3,
          );
          const shiftX =
            ((nextWidth - drag.original.width) * width * drag.handle.x) / 2;
          const shiftY =
            ((nextHeight - drag.original.height) * height * drag.handle.y) / 2;
          const angle = (region.rotation * Math.PI) / 180;
          drag.value = {
            x: clamp(
              drag.original.x +
                (shiftX * Math.cos(angle) - shiftY * Math.sin(angle)) / width,
              -1,
              2,
            ),
            y: clamp(
              drag.original.y +
                (shiftX * Math.sin(angle) + shiftY * Math.cos(angle)) / height,
              -1,
              2,
            ),
            width: nextWidth,
            height: nextHeight,
          };
        } else
          drag.value = {
            ...drag.original,
            x: clamp(drag.original.x + delta.x / width, -1, 2),
            y: clamp(drag.original.y + delta.y / height, -1, 2),
          };
        setDraft(drag.value);
        onDraft(drag.value);
      }}
      onPointerUp={(event) => {
        const drag = gesture.current;
        if (!drag) return;
        event.stopPropagation();
        if (
          Object.keys(drag.value).some(
            (key) =>
              drag.value[key as keyof Geometry] !==
              drag.original[key as keyof Geometry],
          )
        )
          onCommit(drag.value);
        cancel();
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          cancel();
          return;
        }
        if (
          !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
            event.key,
          )
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        const step = event.shiftKey ? 10 : 1;
        onCommit({
          x: clamp(
            region.x +
              (event.key === "ArrowRight"
                ? step
                : event.key === "ArrowLeft"
                  ? -step
                  : 0) /
                width,
            -1,
            2,
          ),
          y: clamp(
            region.y +
              (event.key === "ArrowDown"
                ? step
                : event.key === "ArrowUp"
                  ? -step
                  : 0) /
                height,
            -1,
            2,
          ),
          width: region.width,
          height: region.height,
        });
      }}
    >
      <span className="effect-region-caption">{name}</span>
      {moveHandleOnly && showMoveHandle && (
        <button
          type="button"
          className="effect-region-move"
          data-region-move
          aria-label={`移动${name}区域`}
          title={`拖动此控制点移动${name}`}
          style={{
            transform: `translate(-50%, -50%) ${selectionControlScale(pose, cameraScale)}`,
          }}
        >
          <Move size={14} aria-hidden="true" />
        </button>
      )}
      {resizeHandles.map((handle) => (
        <button
          key={handle.name}
          data-region-handle={handle.name}
          aria-label={
            handle.name === "se"
              ? `调整${name}区域大小`
              : `调整${name}区域 ${handle.name}`
          }
          className={`effect-region-resize ${handle.name}`}
          style={{
            left: `${(handle.x + 1) * 50}%`,
            top: `${(handle.y + 1) * 50}%`,
            right: "auto",
            bottom: "auto",
            transform: "translate(-50%, -50%)",
            cursor: `${handle.name}-resize`,
          }}
        />
      ))}
    </div>
  );
}
