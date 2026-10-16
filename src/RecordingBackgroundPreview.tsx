import { useEffect, useState } from "react";
import {
  recordingBackgrounds,
  type RecordingSettings,
} from "../shared/recording-settings";
import { recordingWallpaperUrl } from "../shared/recording-backgrounds";

/** Share media preview between the picker, recording dialog and inspector. */
export default function RecordingBackgroundPreview({
  settings,
  className,
}: {
  settings: Pick<RecordingSettings, "preset" | "customBackground">;
  className?: string;
}) {
  const customId =
    settings.preset === "custom" ? settings.customBackground?.id : undefined;
  const [customUrl, setCustomUrl] = useState({ id: "", url: "", error: false });
  useEffect(() => {
    if (!customId) return;
    let active = true;
    window.framecraft?.mediaUrl(customId).then(
      (url) => {
        if (active) setCustomUrl({ id: customId, url, error: false });
      },
      () => {
        if (active) setCustomUrl({ id: customId, url: "", error: true });
      },
    );
    return () => {
      active = false;
    };
  }, [customId]);
  if (settings.preset === "custom") {
    const src = customUrl.id === customId ? customUrl.url : "";
    const failed = customUrl.id === customId && customUrl.error;
    if (!src || failed)
      return (
        <span className={className}>
          {failed ? "背景无法读取，请重新选择" : ""}
        </span>
      );
    const onError = () => setCustomUrl({ id: customId!, url: "", error: true });
    return settings.customBackground?.kind === "video" ? (
      <video
        className={className}
        src={src}
        autoPlay
        loop
        muted
        playsInline
        onError={onError}
      />
    ) : (
      <img className={className} src={src} alt="自定义背景" onError={onError} />
    );
  }
  const entry = recordingBackgrounds[settings.preset];
  if ("file" in entry)
    return entry.animated ? (
      <video
        className={className}
        src={recordingWallpaperUrl(entry.file)}
        autoPlay
        loop
        muted
        playsInline
      />
    ) : (
      <img
        className={className}
        src={recordingWallpaperUrl(entry.file)}
        alt={entry.name}
      />
    );
  return (
    <div
      className={className}
      style={{
        background: `linear-gradient(135deg,${entry.colors.join(",")})`,
      }}
    />
  );
}
