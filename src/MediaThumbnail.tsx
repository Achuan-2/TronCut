import { memo, useEffect, useState, type CSSProperties } from "react";
import type { Asset } from "../shared/model";

export const MediaThumbnail = memo(
  function MediaThumbnail({
    asset,
    waveform = false,
    style,
  }: {
    asset: Asset;
    waveform?: boolean;
    style?: CSSProperties;
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
}, (prev, next) => {
  return (
    prev.waveform === next.waveform &&
    prev.asset.id === next.asset.id &&
    prev.asset.path === next.asset.path &&
    prev.asset.missing === next.asset.missing &&
    prev.style?.width === next.style?.width &&
    prev.style?.left === next.style?.left
  );
});
