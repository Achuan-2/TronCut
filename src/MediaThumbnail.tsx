import { useEffect, useState } from "react";
import type { Asset } from "../shared/model";

export function MediaThumbnail({
  asset,
  waveform = false,
  style,
}: {
  asset: Asset;
  waveform?: boolean;
  style?: React.CSSProperties;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    window.framecraft
      ?.mediaThumbnail(asset.id, waveform)
      .then((result) => {
        if (alive) setUrl(result);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [asset.id, asset.path, asset.missing, waveform]);
  return url ? (
    <img
      className={waveform ? "waveform-image" : "thumbnail-image"}
      src={url}
      alt={waveform ? "音频波形" : asset.name}
      draggable={false}
      style={style}
    />
  ) : null;
}
