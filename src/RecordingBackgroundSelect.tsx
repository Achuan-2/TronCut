import {
  recordingBackgrounds,
  type RecordingSettings,
  type RecordingBackground,
} from "../shared/recording-settings";

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
  const groups: { name: string; items: typeof entries }[] = [
    {
      name: "静态背景",
      items: entries.filter(([, entry]) => "file" in entry && !entry.animated),
    },
    {
      name: "动态背景",
      items: entries.filter(([, entry]) => "file" in entry && entry.animated),
    },
    {
      name: "渐变背景",
      items: entries.filter(([, entry]) => "colors" in entry),
    },
  ];
  return (
    <label className="field">
      背景
      <select
        aria-label={label}
        disabled={disabled}
        value={settings.background ? settings.preset : "none"}
        onChange={(event) =>
          onChange(
            event.target.value === "none"
              ? { background: false }
              : {
                  background: true,
                  preset: event.target.value as RecordingBackground,
                },
          )
        }
      >
        <option value="none">无背景</option>
        {groups.map(({ name, items }) => (
          <optgroup key={name} label={name}>
            {items.map(([id, entry]) => (
              <option key={id} value={id}>
                {entry.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
