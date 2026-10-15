import { type TextStyle, textFillDefaults } from "../shared/model";
import { textFill } from "../shared/text";

export default function TextFillFields({
  style,
  onChange,
}: {
  style?: TextStyle;
  onChange: (patch: Partial<TextStyle>) => void;
}) {
  const fill = textFill(style);
  const enabled = style?.fillEnabled ?? textFillDefaults.fillEnabled;
  const opacity = Math.round(
    (style?.fillOpacity ?? textFillDefaults.fillOpacity) * 100,
  );
  const setOpacity = (value: string) => {
    const next = Number(value);
    if (Number.isFinite(next))
      onChange({ fillOpacity: Math.max(0, Math.min(100, next)) / 100 });
  };
  return (
    <>
      <label className="check-field">
        <input
          type="checkbox"
          role="switch"
          aria-label="启用背景色"
          checked={enabled}
          onChange={(event) => onChange({ fillEnabled: event.target.checked })}
        />
        背景色
      </label>
      <label className="field">
        填充颜色
        <input
          type="color"
          disabled={!enabled}
          value={fill.color}
          onChange={(event) => onChange({ fill: event.target.value })}
        />
      </label>
      <label className="field vertical">
        <span>填充不透明度</span>
        <span className="text-fill-opacity-controls">
          <input
            type="range"
            disabled={!enabled}
            aria-label="填充不透明度滑块"
            min="0"
            max="100"
            step="1"
            value={opacity}
            onChange={(event) => setOpacity(event.target.value)}
          />
          <input
            type="number"
            disabled={!enabled}
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
      {(
        [
          ["fillPaddingX", "水平内边距 (px)"],
          ["fillPaddingY", "垂直内边距 (px)"],
          ["fillRadius", "填充圆角 (px)"],
        ] as const
      ).map(([key, label]) => (
        <label className="field" key={key}>
          {label}
          <input
            type="number"
            disabled={!enabled}
            min="0"
            max="200"
            step="1"
            value={style?.[key] ?? textFillDefaults[key]}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value))
                onChange({ [key]: Math.max(0, Math.min(200, value)) });
            }}
          />
        </label>
      ))}
    </>
  );
}
