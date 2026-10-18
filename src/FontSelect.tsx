import { useEffect, useState } from "react";

let installedFonts: Promise<string[]> | undefined;
function localFonts() {
  const query = (
    window as Window & { queryLocalFonts?: () => Promise<{ family: string }[]> }
  ).queryLocalFonts;
  if (!query) return Promise.reject(new Error("当前环境无法读取本机字体"));
  installedFonts ??= query
    .call(window)
    .then((fonts) =>
      [
        ...new Set(
          fonts
            .map((font) => font.family)
            .filter((family) => family && family.length <= 100),
        ),
      ].sort((a, b) => a.localeCompare(b, "zh-CN")),
    )
    .catch((error) => {
      installedFonts = undefined;
      throw error;
    });
  return installedFonts;
}

export default function FontSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (font: string) => void;
}) {
  const [fonts, setFonts] = useState<string[]>([]);
  const [error, setError] = useState("");
  const load = () => {
    void localFonts()
      .then((fonts) => {
        setFonts(fonts);
        setError("");
      })
      .catch((error: Error) => setError(error.message));
  };
  useEffect(load, []);
  return (
    <>
      <label className="field">
        字体
        <select
          aria-label="字体"
          value={value}
          onFocus={() => {
            if (!fonts.length) load();
          }}
          onChange={(event) => onChange(event.target.value)}
          title={error || `本机字体（${fonts.length}）`}
        >
          {!fonts.includes(value) && (
            <option value={value}>
              {value}
              {fonts.length ? "（工程字体）" : ""}
            </option>
          )}
          {fonts.map((font) => (
            <option key={font} value={font} style={{ fontFamily: font }}>
              {font}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="field-help">{error}，点击字体框可重试。</p>}
    </>
  );
}
