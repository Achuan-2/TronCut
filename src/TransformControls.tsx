import { useRef, type CSSProperties } from "react";
import { RotateCcw, RotateCw } from "lucide-react";
import type { Transform } from "../shared/model";
import NumberInput from "./NumberInput";

export function PropertyResetButton({
  label,
  value,
  defaultValue,
  precision = 3,
  onReset,
  disabled,
}: {
  label: string;
  value: number;
  defaultValue: number;
  precision?: number;
  onReset: () => void;
  disabled?: boolean;
}) {
  const isDefault = Number(value.toFixed(precision)) === defaultValue;
  return (
    <button
      type="button"
      className="property-reset"
      title={label}
      aria-label={label}
      aria-hidden={isDefault || undefined}
      tabIndex={isDefault ? -1 : undefined}
      style={{ visibility: isDefault ? "hidden" : undefined }}
      disabled={disabled || isDefault}
      onClick={onReset}
    >
      <RotateCcw size={14} />
    </button>
  );
}

export function ScaleControl({
  value,
  min = 5,
  onChange,
  disabled,
}: {
  value: number;
  min?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <PropertySlider
      className="transform-scale"
      label="缩放"
      ariaLabel="缩放 (%)"
      value={value}
      min={min}
      max={800}
      step={0.1}
      unit="%"
      onChange={onChange}
      defaultValue={100}
      onReset={() => onChange(100)}
      disabled={disabled}
    />
  );
}

function RotationAxis({
  axis,
  value,
  onChange,
  disabled,
}: {
  axis: "X" | "Y" | "Z";
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const gesture = useRef<{
    angle: number;
    value: number;
    cx: number;
    cy: number;
  } | null>(null);
  const change = (next: number) => {
    if (Number.isFinite(next))
      onChange(Math.max(-3600, Math.min(3600, Math.round(next * 10) / 10)));
  };
  return (
    <div className="rotation-axis">
      <RotateCw
        className={`rotation-axis-icon axis-${axis.toLowerCase()}`}
        size={23}
      />
      <button
        className="rotation-dial"
        aria-label={`旋转 ${axis} 拨盘`}
        title={`拖动拨盘调整 ${axis} 轴旋转；双击归零`}
        disabled={disabled}
        onDoubleClick={() => change(0)}
        onKeyDown={(event) => {
          if (
            [
              "ArrowLeft",
              "ArrowDown",
              "ArrowRight",
              "ArrowUp",
              "Home",
            ].includes(event.key)
          ) {
            event.preventDefault();
            event.stopPropagation();
            change(
              event.key === "Home"
                ? 0
                : value +
                    (["ArrowLeft", "ArrowDown"].includes(event.key) ? -1 : 1) *
                      (event.shiftKey ? 10 : 1),
            );
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          const rect = event.currentTarget.getBoundingClientRect(),
            cx = rect.x + rect.width / 2,
            cy = rect.y + rect.height / 2;
          gesture.current = {
            angle: Math.atan2(event.clientY - cy, event.clientX - cx),
            value,
            cx,
            cy,
          };
        }}
        onPointerMove={(event) => {
          const drag = gesture.current;
          if (!drag) return;
          const angle = Math.atan2(
            event.clientY - drag.cy,
            event.clientX - drag.cx,
          );
          let delta = angle - drag.angle;
          if (delta > Math.PI) delta -= Math.PI * 2;
          if (delta < -Math.PI) delta += Math.PI * 2;
          drag.value = Math.max(
            -3600,
            Math.min(3600, drag.value + (delta * 180) / Math.PI),
          );
          drag.angle = angle;
          change(drag.value);
        }}
        onPointerUp={() => {
          gesture.current = null;
        }}
        onPointerCancel={() => {
          gesture.current = null;
        }}
        onLostPointerCapture={() => {
          gesture.current = null;
        }}
      >
        <span style={{ transform: `rotate(${value}deg)` }}>
          <i />
        </span>
      </button>
      <span className="rotation-axis-name">{axis}</span>
      <div className="transform-number">
        <NumberInput
          aria-label={`旋转 ${axis} (度)`}
          min={-3600}
          max={3600}
          step={0.1}
          value={Number(value.toFixed(1))}
          disabled={disabled}
          onValueChange={change}
        />
        <span>°</span>
      </div>
      <PropertyResetButton
        label={`重置旋转 ${axis}`}
        value={value}
        defaultValue={0}
        precision={1}
        disabled={disabled}
        onReset={() => change(0)}
      />
    </div>
  );
}

export function PropertySlider({
  className = "",
  label,
  ariaLabel,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
  onReset,
  defaultValue = 0,
  disabled,
}: {
  className?: string;
  label: string;
  ariaLabel: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
  onReset?: () => void;
  defaultValue?: number;
  disabled?: boolean;
}) {
  const change = (value: number) => {
    if (Number.isFinite(value) && value >= min && value <= max) onChange(value);
  };
  const progress = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  return (
    <div className={`property-slider-row ${className}`}>
      <span>{label}</span>
      <div className="property-slider-control">
        <input
          type="range"
          aria-label={`${label}滑条`}
          min={min}
          max={max}
          step={step}
          value={value}
          style={{ "--slider-progress": `${progress}%` } as CSSProperties}
          disabled={disabled}
          onChange={(event) => change(Number(event.target.value))}
        />
        <div className="transform-number">
          <NumberInput
            aria-label={ariaLabel}
            min={min}
            max={max}
            step={step}
            value={Number(value.toFixed(3))}
            disabled={disabled}
            onValueChange={change}
          />
          {unit && <span>{unit}</span>}
        </div>
      </div>
      {onReset ? (
        <PropertyResetButton
          label={`重置${label}`}
          value={value}
          defaultValue={defaultValue}
          disabled={disabled}
          onReset={onReset}
        />
      ) : (
        <span className="property-reset-spacer" />
      )}
    </div>
  );
}

export function RotationControls({
  value,
  fallbackZ = 0,
  onChange,
  disabled,
}: {
  value: Transform;
  fallbackZ?: number;
  onChange: (key: keyof Transform, value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="rotation-controls">
      <span>旋转</span>
      <div>
        {(["Z", "Y", "X"] as const).map((axis) => {
          const key =
            axis === "Z"
              ? "rotation"
              : axis === "Y"
                ? "rotationY"
                : "rotationX";
          return (
            <RotationAxis
              key={axis}
              axis={axis}
              value={value[key] ?? (axis === "Z" ? fallbackZ : 0)}
              onChange={(next) => onChange(key, next)}
              disabled={disabled}
            />
          );
        })}
      </div>
    </div>
  );
}
