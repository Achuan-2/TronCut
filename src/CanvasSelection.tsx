import type { PointerEvent, PointerEventHandler } from "react";
import { RotateCw } from "lucide-react";
import type { Transform } from "../shared/model";
import type { Point } from "../shared/annotation-style";
import { depthScale } from "../shared/rotation";
import { lineMidpoint, type LineHandle } from "../shared/line-edit";
import "./CanvasSelection.css";

export function selectionControlScale(pose: Transform, cameraScale: number) {
  const scale = pose.scale * depthScale(pose.z) * cameraScale;
  return `scale(${1 / (scale * (pose.scaleX ?? 1))}, ${1 / (scale * (pose.scaleY ?? 1))})`;
}

export function RotationHandle({
  pose,
  cameraScale,
  angle,
  onPointerDown,
}: {
  pose: Transform;
  cameraScale: number;
  angle?: number;
  onPointerDown: PointerEventHandler<HTMLButtonElement>;
}) {
  return (
    <button
      type="button"
      className="rotation-handle"
      aria-label="旋转选中对象"
      title="拖动旋转，按住 Shift 以 15° 吸附"
      style={{
        transform: `translateX(-50%) ${selectionControlScale(pose, cameraScale)} translateY(-42px)`,
      }}
      onPointerDown={onPointerDown}
    >
      <RotateCw size={16} />
      {angle !== undefined && (
        <span className="rotation-angle">{angle.toFixed(1)}°</span>
      )}
    </button>
  );
}

export function LineSelection({
  points,
  size,
  pose,
  scale,
  cameraScale,
  selected,
  onHandleDown,
}: {
  points: Point[];
  size: { width: number; height: number };
  pose: Transform;
  scale: number;
  cameraScale: number;
  selected: boolean;
  onHandleDown: (
    handle: LineHandle,
    event: PointerEvent<HTMLButtonElement>,
  ) => void;
}) {
  const handles = [
    { key: "start", label: "起点", point: points[0] },
    { key: "bend", label: "弯曲", point: lineMidpoint(points) },
    { key: "end", label: "终点", point: points.at(-1)! },
  ] as const;
  return (
    <>
      <svg
        className="line-hit-area"
        width="100%"
        height="100%"
        viewBox={`0 0 ${size.width} ${size.height}`}
        aria-hidden="true"
      >
        <path
          d={points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke="transparent"
          strokeWidth={
            14 / (scale * pose.scale * depthScale(pose.z) * cameraScale)
          }
        />
      </svg>
      {selected &&
        handles.map(({ key, label, point }) => (
          <button
            type="button"
            key={key}
            className={`resize-handle line-control ${key}`}
            aria-label={`调整箭头${label}`}
            title={
              key === "bend"
                ? "拖动中点调整弯曲"
                : `拖动${label}调整长度和方向，按住 Shift 以 15° 吸附`
            }
            style={{
              left: `${(point.x / size.width) * 100}%`,
              top: `${(point.y / size.height) * 100}%`,
              transform: `translate(-50%, -50%) ${selectionControlScale(pose, cameraScale)}`,
            }}
            onPointerDown={(event) => onHandleDown(key, event)}
          />
        ))}
    </>
  );
}
