import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { TextStyle } from "../shared/model";
import { textFormatCss } from "../shared/text-format";
import type { TextPreset } from "../shared/preset-library";

function matchesPreset(style: TextStyle | undefined, preset: TextPreset) {
  if (!style) return false;
  return (
    style.fontFamily === preset.style.fontFamily &&
    style.color.toLowerCase() === preset.style.color.toLowerCase() &&
    style.outline.toLowerCase() === preset.style.outline.toLowerCase() &&
    style.outlineWidth === preset.style.outlineWidth &&
    (style.bold !== false) === (preset.style.bold !== false) &&
    !!style.italic === !!preset.style.italic &&
    !!style.underline === !!preset.style.underline
  );
}

function sampleStyle(style: TextStyle): CSSProperties {
  const fontFamily = style.fontFamily.replace(/["\\]/g, "");
  return {
    ...textFormatCss(style),
    color: style.color,
    fontFamily: `"${fontFamily}", "Microsoft YaHei", sans-serif`,
    WebkitTextStroke: `${Math.min(1.8, style.outlineWidth * 0.3)}px ${style.outline}`,
    paintOrder: "stroke fill",
    ...(style.fillEnabled
      ? {
          background: style.fill ?? "#000000",
          borderRadius: Math.min(7, style.fillRadius ?? 6),
        }
      : {}),
  };
}

export default function TextPresetPicker({
  presets,
  style,
  disabled,
  onSelect,
}: {
  presets: TextPreset[];
  style?: TextStyle;
  disabled?: boolean;
  onSelect: (preset: TextPreset) => void;
}) {
  const [open, setOpen] = useState(false);
  const picker = useRef<HTMLDivElement>(null);
  const selected = presets.find((preset) => matchesPreset(style, preset));
  const preview = selected?.style ?? style;

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!picker.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="field text-preset-field">
      <span>花字</span>
      <div className="text-preset-picker" ref={picker}>
        <button
          type="button"
          className="text-preset-trigger"
          aria-label={`花字模板：${selected?.name ?? "选择模板"}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          disabled={disabled}
          // Keep the textarea selection while the picker is being used.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setOpen((current) => !current)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
            }
          }}
        >
          <span
            className="text-preset-sample text-preset-trigger-sample"
            style={preview ? sampleStyle(preview) : undefined}
          >
            花字
          </span>
          <span className="text-preset-trigger-name">
            {selected?.name ?? "选择模板"}
          </span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
        {open && (
          <div
            className="text-preset-choices"
            role="listbox"
            aria-label="花字模板"
          >
            {presets.map((preset) => {
              const isSelected = selected?.id === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  aria-label={preset.name}
                  title={preset.name}
                  className={`text-preset-option${isSelected ? " is-selected" : ""}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onSelect(preset);
                    setOpen(false);
                  }}
                >
                  <span
                    className="text-preset-sample"
                    style={sampleStyle(preset.style)}
                  >
                    花字
                  </span>
                  <span className="text-preset-option-name">{preset.name}</span>
                  {isSelected && (
                    <Check
                      className="text-preset-option-check"
                      size={13}
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
            {!presets.length && (
              <p className="text-preset-empty">预设库中还没有花字模板。</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
