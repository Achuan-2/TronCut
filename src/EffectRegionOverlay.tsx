import { useRef, useState } from "react";
import type { Transform } from "../shared/model";
import type { Region } from "../shared/visual-effects";
import { localDelta } from "../shared/rotation";

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
  onDraft,
  onCommit,
}: {
  name: string;
  region: Region | Omit<Region, "opacity">;
  width: number;
  height: number;
  pose: Transform;
  cameraScale: number;
  onDraft: (geometry: Geometry | null) => void;
  onCommit: (geometry: Geometry) => void;
}) {
  const gesture = useRef<{
    x: number;
    y: number;
    resize: boolean;
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
      className="effect-region-outline"
      role="group"
      tabIndex={0}
      aria-label={`${name}编辑区域`}
      style={{
        left: `${value.x * 100}%`,
        top: `${value.y * 100}%`,
        width: `${value.width * 100}%`,
        height: `${value.height * 100}%`,
        borderRadius: region.shape === "ellipse" ? "50%" : region.radius,
        transform: `translate(-50%, -50%) rotate(${region.rotation}deg)`,
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
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
          resize: (event.target as HTMLElement).dataset.resize === "true",
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
        if (drag.resize) {
          const angle = (-region.rotation * Math.PI) / 180;
          delta = {
            x: delta.x * Math.cos(angle) - delta.y * Math.sin(angle),
            y: delta.x * Math.sin(angle) + delta.y * Math.cos(angle),
          };
        }
        drag.value = drag.resize
          ? {
              ...drag.original,
              width: clamp(
                drag.original.width + (2 * delta.x) / width,
                0.01,
                3,
              ),
              height: clamp(
                drag.original.height + (2 * delta.y) / height,
                0.01,
                3,
              ),
            }
          : {
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
      <button
        data-resize="true"
        aria-label={`调整${name}区域大小`}
        className="effect-region-resize"
      />
    </div>
  );
}
