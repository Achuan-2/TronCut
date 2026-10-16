import { EyeOff } from "lucide-react";
import { cursorStyles, cursorSvg } from "../shared/cursor";
import type { Clip } from "../shared/model";
import PreviewSelect from "./PreviewSelect";

type Style = NonNullable<Clip["cursorStyle"]>;
export default function CursorStyleSelect({
  value,
  color = "#ffffff",
  label = "鼠标样式",
  disabled,
  onChange,
}: {
  value: Style["style"];
  color?: string;
  label?: string;
  disabled?: boolean;
  onChange: (value: Style["style"]) => void;
}) {
  return (
    <PreviewSelect
      label={label}
      value={value}
      disabled={disabled}
      onChange={onChange}
      options={Object.entries(cursorStyles).map(([style, name]) => ({
        value: style as Style["style"],
        label: name,
        preview:
          style === "hidden" ? (
            <EyeOff size={20} />
          ) : (
            <img
              alt=""
              className="cursor-style-thumbnail"
              src={`data:image/svg+xml,${encodeURIComponent(cursorSvg({ style: style as Style["style"], color, size: 32, clicks: false, smooth: false }))}`}
            />
          ),
      }))}
    />
  );
}
