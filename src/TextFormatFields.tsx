import { Bold, Italic, Underline } from "lucide-react";
import type { CharacterStyle } from "../shared/model";
import "./TextFormatFields.css";

const formats = [
  { key: "bold", label: "加粗", icon: Bold },
  { key: "italic", label: "斜体", icon: Italic },
  { key: "underline", label: "下划线", icon: Underline },
] as const;

export default function TextFormatFields({
  style,
  disabled,
  onChange,
}: {
  style?: CharacterStyle;
  disabled?: boolean;
  onChange: (patch: CharacterStyle) => void;
}) {
  return (
    <div className="text-format-fields" role="group" aria-label="文字格式">
      <span>文字格式</span>
      <div>
        {formats.map(({ key, label, icon: Icon }) => {
          const active =
            key === "bold" ? style?.bold !== false : !!style?.[key];
          return (
            <button
              key={key}
              type="button"
              aria-label={label}
              title={label}
              aria-pressed={active}
              disabled={disabled}
              // Preserve a canvas selection while applying multiple formats.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onChange({ [key]: !active })}
            >
              <Icon size={16} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
