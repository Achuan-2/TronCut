import { AlignCenter, LockKeyhole, RotateCcw } from "lucide-react";
import type { Clip, Transform } from "../shared/model";
import {
  ScaleControl,
  RotationControls,
  PropertySlider,
} from "./TransformControls";

export default function FrameTransformProperties({
  clip,
  value,
  canvas,
  size,
  editingContent,
  content,
  disabled,
  onTransform,
  onContentOrFrame,
  onResize,
  onCenter,
}: {
  clip: Clip;
  value: Transform;
  canvas: { width: number; height: number };
  size: { width: number; height: number };
  editingContent: boolean;
  content: { x: number; y: number; scale: number };
  disabled?: boolean;
  onTransform: (key: keyof Transform, value: number) => void;
  onContentOrFrame: (key: "x" | "y" | "scale", value: number) => void;
  onResize: (axis: "width" | "height", pixels: number) => void;
  onCenter: () => void;
}) {
  const positions = editingContent
    ? [content.x * 100, content.y * 100]
    : [
        (value.x - 0.5) * canvas.width,
        (0.5 - value.y) * canvas.height,
        value.z ?? 0,
      ];
  return (
    <div className="frame-transform-properties">
      {editingContent && <p className="field-help">框内画面</p>}
      <ScaleControl
        value={(editingContent ? content.scale : value.scale) * 100}
        onChange={(scale) => onContentOrFrame("scale", scale / 100)}
        disabled={disabled}
      />
      <PropertySlider
        label="不透明度"
        ariaLabel="不透明度 (%)"
        value={value.opacity * 100}
        min={0}
        max={100}
        step={1}
        unit="%"
        onChange={(opacity) => onTransform("opacity", opacity / 100)}
        disabled={disabled}
      />
      {!editingContent && (
        <RotationControls
          value={value}
          fallbackZ={clip.rotation}
          onChange={onTransform}
          disabled={disabled}
        />
      )}
      <div className="position-controls property-group">
        <span>{editingContent ? "内容位置" : "位置"}</span>
        <div className="position-axes">
          {positions.map((position, index) => {
            const axis = (["X", "Y", "Z"] as const)[index];
            const label = editingContent
              ? `内容位置 ${axis} (%)`
              : `位置 ${axis} (px)`;
            const origin = editingContent ? 0 : index < 2 ? 0.5 : 0;
            return (
              <label className="position-axis" key={axis}>
                <span>{axis}</span>
                <input
                  aria-label={label}
                  type="number"
                  step={0.1}
                  min={index === 2 ? -10000 : undefined}
                  max={index === 2 ? 1000 : undefined}
                  value={Number(position.toFixed(3))}
                  disabled={disabled}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (!Number.isFinite(next)) return;
                    if (index === 2) {
                      if (next >= -10000 && next <= 1000)
                        onTransform("z", next);
                    } else {
                      const coordinate = editingContent
                        ? next / 100
                        : index === 0
                          ? next / canvas.width + origin
                          : origin - next / canvas.height;
                      if (coordinate >= -4 && coordinate <= 4)
                        onContentOrFrame(index === 0 ? "x" : "y", coordinate);
                    }
                  }}
                />
                <button
                  className="property-reset"
                  type="button"
                  aria-label={`重置${editingContent ? "内容位置" : "位置"} ${axis}`}
                  title={`重置位置 ${axis}`}
                  disabled={disabled}
                  onClick={() =>
                    index === 2
                      ? onTransform("z", 0)
                      : onContentOrFrame(index === 0 ? "x" : "y", origin)
                  }
                >
                  <RotateCcw size={14} />
                </button>
              </label>
            );
          })}
          <button
            className="center-layer"
            title={editingContent ? "内容居中" : "画布居中"}
            aria-label={editingContent ? "内容居中" : "画布居中"}
            disabled={disabled}
            onClick={onCenter}
          >
            <AlignCenter size={14} />
          </button>
        </div>
      </div>
      <div className="dimension-controls property-group">
        {(["width", "height"] as const).map((axis, index) => (
          <label className="dimension-axis" key={axis}>
            <span>{index ? "高度" : "宽度"}</span>
            <input
              type="number"
              aria-label={`${index ? "高度" : "宽度"} (px)`}
              min={1}
              max={262144}
              step={0.1}
              value={Number((size[axis] * value.scale).toFixed(3))}
              disabled={disabled || editingContent}
              onChange={(event) => {
                const pixels = Number(event.target.value);
                if (Number.isFinite(pixels) && pixels >= 1 && pixels <= 262144)
                  onResize(axis, pixels);
              }}
            />
          </label>
        ))}
        {clip.kind !== "text" && (
          <span className="dimension-lock" title="宽高保持比例">
            <LockKeyhole size={13} />
          </span>
        )}
      </div>
      {!editingContent && (
        <PropertySlider
          label="倾斜度"
          ariaLabel="倾斜度 (度)"
          value={value.skew ?? 0}
          min={-80}
          max={80}
          step={0.1}
          onChange={(skew) => onTransform("skew", skew)}
          onReset={() => onTransform("skew", 0)}
          disabled={disabled}
        />
      )}
    </div>
  );
}
