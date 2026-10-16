import {
  recordingBackgrounds,
  type RecordingSettings,
  type RecordingBackground,
} from "../shared/recording-settings";
import { Ban } from "lucide-react";
import { recordingWallpaperUrl } from "../shared/recording-backgrounds";
import PreviewSelect from "./PreviewSelect";

export default function RecordingBackgroundSelect({
  settings,
  onChange,
  disabled = false,
  label = "录屏背景",
}: {
  settings: Pick<RecordingSettings, "background" | "preset">;
  onChange: (
    patch: Pick<RecordingSettings, "background"> &
      Partial<Pick<RecordingSettings, "preset">>,
  ) => void;
  disabled?: boolean;
  label?: string;
}) {
  const entries = Object.entries(recordingBackgrounds);
  return (
    <label className="field">
      背景
      <PreviewSelect
        label={label}
        disabled={disabled}
        value={settings.background ? settings.preset : "none"}
        onChange={(value) =>
          onChange(
            value === "none"
              ? { background: false }
              : {
                  background: true,
                  preset: value as RecordingBackground,
                },
          )
        }
        options={[
          { value: "none", label: "无背景", preview: <Ban size={18} /> },
          ...entries.map(([id, entry]) => ({
            value: id,
            label: entry.name,
            preview:
              "file" in entry ? (
                entry.animated ? (
                  <video
                    src={recordingWallpaperUrl(entry.file)}
                    autoPlay
                    loop
                    muted
                    playsInline
                  />
                ) : (
                  <img src={recordingWallpaperUrl(entry.file)} alt="" />
                )
              ) : (
                <span
                  style={{
                    background: `linear-gradient(135deg,${entry.colors.join(",")})`,
                  }}
                />
              ),
          })),
        ]}
      />
    </label>
  );
}
