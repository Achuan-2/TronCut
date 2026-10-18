import type { CameraStyle } from "../shared/recording-settings";
import CameraPreview from "./CameraPreview";
import NumberInput from "./NumberInput";

export default function RecordingCameraSettings({
  stream,
  style,
  error,
  disabled,
  onChange,
  onRetry,
}: {
  stream: MediaStream | null;
  style: CameraStyle;
  error: string;
  disabled: boolean;
  onChange: (style: CameraStyle) => void;
  onRetry: () => void;
}) {
  return (
    <fieldset className="recording-camera-settings" disabled={disabled}>
      <legend>摄像头画面</legend>
      <CameraPreview
        stream={stream}
        style={style}
        onPosition={(maskX, maskY) => {
          if (!disabled) onChange({ ...style, maskX, maskY });
        }}
      />
      <label className="check-field">
        <input
          type="checkbox"
          aria-label="镜像摄像头画面"
          checked={style.mirror}
          onChange={(event) =>
            onChange({ ...style, mirror: event.target.checked })
          }
        />
        镜像画面
      </label>
      {error && (
        <p className="error-box">
          {error}
          <button type="button" onClick={onRetry}>
            重试摄像头
          </button>
        </p>
      )}
      <label className="field">
        摄像头预设
        <select
          aria-label="摄像头预设"
          value={style.preset}
          onChange={(event) =>
            onChange({
              ...style,
              preset: event.target.value as CameraStyle["preset"],
            })
          }
        >
          <option value="rectangle">原始画面</option>
          <option value="rounded">圆角方形</option>
          <option value="circle">圆形蒙版</option>
        </select>
      </label>
      {style.preset !== "rectangle" && (
        <div className="recording-style-fields">
          {(
            [
              ["蒙版水平位置", "maskX", 0, 100],
              ["蒙版垂直位置", "maskY", 0, 100],
              ["蒙版大小", "maskSize", 20, 100],
            ] as const
          ).map(([label, key, min, max]) => (
            <label className="field" key={key}>
              {label} (%)
              <NumberInput
                aria-label={label}
                min={min}
                max={max}
                value={Math.round(style[key] * 100)}
                onValueChange={(value) =>
                  onChange({ ...style, [key]: value / 100 })
                }
              />
            </label>
          ))}
        </div>
      )}
      <p className="field-help">
        {style.preset !== "rectangle" ? "可在预览中拖动调整蒙版位置。" : ""}
        摄像头单独保存为独立图层，录制后仍可调整翻转和蒙版。
      </p>
    </fieldset>
  );
}
