import type { TextStyle } from "../shared/model";
import { textFill } from "../shared/text";

export default function TextFillFields({
  style,
  onChange,
}: {
  style?: TextStyle;
  onChange: (patch: Partial<TextStyle>) => void;
}) {
  const fill = textFill(style);
  const opacity = Math.round(fill.opacity * 100);
  const setOpacity = (value: string) => {
    const next = Number(value);
    if (Number.isFinite(next))
      onChange({ fillOpacity: Math.max(0, Math.min(100, next)) / 100 });
  };
  return (
    <>
      <label className="field">
        填充颜色
        <input
          type="color"
          value={fill.color}
          onChange={(event) => onChange({ fill: event.target.value })}
        />
      </label>
      <label className="field vertical">
        <span>填充不透明度</span>
        <span className="text-fill-opacity-controls">
          <input
            type="range"
            aria-label="填充不透明度滑块"
            min="0"
            max="100"
            step="1"
            value={opacity}
            onChange={(event) => setOpacity(event.target.value)}
          />
          <input
            type="number"
            aria-label="填充不透明度 (%)"
            min="0"
            max="100"
            step="1"
            value={opacity}
            onChange={(event) => setOpacity(event.target.value)}
          />
          <span>%</span>
        </span>
      </label>
    </>
  );
}
