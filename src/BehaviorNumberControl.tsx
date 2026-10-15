import { useState } from "react";

export default function BehaviorNumberControl({
  label,
  name,
  value,
  min,
  max,
  sliderMax = max,
  step = 0.01,
  digits = 2,
  unit = "",
  disabled = false,
  change,
}: {
  label: string;
  name: string;
  value: number;
  min: number;
  max: number;
  sliderMax?: number;
  step?: number;
  digits?: number;
  unit?: string;
  disabled?: boolean;
  change: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="field behavior-number-control">
      <span>{label}</span>
      <input
        aria-label={`${name}滑块`}
        type="range"
        min={min}
        max={sliderMax}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => change(Number(event.target.value))}
      />
      <div className="behavior-number-input">
        <input
          aria-label={name}
          type="number"
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          value={draft ?? value.toFixed(digits)}
          onFocus={(event) => setDraft(event.target.value)}
          onBlur={() => setDraft(null)}
          onChange={(event) => {
            const text = event.target.value;
            setDraft(text);
            const next = Number(text);
            if (
              text.trim() &&
              Number.isFinite(next) &&
              next >= min &&
              next <= max
            )
              change(next);
          }}
        />
        {unit && <span>{unit}</span>}
      </div>
    </div>
  );
}
