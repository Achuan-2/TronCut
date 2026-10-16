import { useEffect, useState } from "react";
import {
  recordingBackgrounds,
  type RecordingSettings,
  type RecordingBackground,
  type CustomRecordingBackground,
} from "../shared/recording-settings";
import { Ban, Upload } from "lucide-react";
import PreviewSelect from "./PreviewSelect";
import RecordingBackgroundPreview from "./RecordingBackgroundPreview";

type BackgroundSettings = Pick<
  RecordingSettings,
  "background" | "preset" | "customBackground"
>;
export default function RecordingBackgroundSelect({
  settings,
  onChange,
  disabled = false,
  label = "录屏背景",
}: {
  settings: BackgroundSettings;
  onChange: (patch: Partial<BackgroundSettings>) => void | Promise<void>;
  disabled?: boolean;
  label?: string;
}) {
  const [remembered, setRemembered] = useState<CustomRecordingBackground>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    window.framecraft
      ?.recordingSettings()
      .then((saved) => {
        if (active) setRemembered(saved.customBackground);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const custom = settings.customBackground ?? remembered;
  async function upload() {
    setBusy(true);
    setError("");
    try {
      const background = await window.framecraft!.selectRecordingBackground();
      if (!background) return;
      setRemembered(background);
      await onChange({
        background: true,
        preset: "custom",
        customBackground: background,
      });
    } catch (error) {
      setError(`导入背景失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="recording-background-control">
      <label className="field">
        背景
        <PreviewSelect
          label={label}
          disabled={disabled || busy}
          value={settings.background ? settings.preset : "none"}
          onChange={(value) =>
            void onChange(
              value === "none"
                ? { background: false }
                : {
                    background: true,
                    preset: value as RecordingBackground,
                    ...(value === "custom" ? { customBackground: custom } : {}),
                  },
            )
          }
          options={[
            { value: "none", label: "无背景", preview: <Ban size={18} /> },
            ...Object.entries(recordingBackgrounds).map(([id, entry]) => ({
              value: id,
              label: entry.name,
              preview: (
                <RecordingBackgroundPreview
                  settings={{ preset: id as RecordingBackground }}
                />
              ),
            })),
            ...(custom
              ? [
                  {
                    value: "custom",
                    label: `自定义 · ${custom.name}`,
                    preview: (
                      <RecordingBackgroundPreview
                        settings={{
                          preset: "custom",
                          customBackground: custom,
                        }}
                      />
                    ),
                  },
                ]
              : []),
          ]}
        />
      </label>
      <button
        type="button"
        className="recording-background-upload"
        disabled={disabled || busy}
        onClick={() => void upload()}
      >
        <Upload size={14} />
        {busy ? "正在导入…" : "自定义背景"}
      </button>
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
    </div>
  );
}
