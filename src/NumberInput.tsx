import { useState, type InputHTMLAttributes } from "react";

/** Keep incomplete edits local; only valid numbers reach persisted settings. */
export default function NumberInput({
  value,
  onValueChange,
  min,
  max,
  ...props
}: Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type"
> & {
  value: number;
  onValueChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      {...props}
      type="number"
      min={min}
      max={max}
      value={draft ?? value}
      onFocus={(event) => {
        setDraft(event.target.value);
        props.onFocus?.(event);
      }}
      onBlur={(event) => {
        setDraft(null);
        props.onBlur?.(event);
      }}
      onChange={(event) => {
        const text = event.target.value;
        setDraft(text);
        const next = event.target.valueAsNumber;
        if (
          text.trim() &&
          Number.isFinite(next) &&
          (min === undefined || next >= Number(min)) &&
          (max === undefined || next <= Number(max))
        )
          onValueChange(next);
      }}
    />
  );
}
