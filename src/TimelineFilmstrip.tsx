import { memo, useEffect, useMemo, useState } from "react";
import type { Asset, Clip } from "../shared/model";
import { timelineFilmstripTiles } from "../shared/timeline-filmstrip";
import { timelineThumbnails } from "./timeline-thumbnails";

function Tile({
  asset,
  time,
  left,
  width,
}: {
  asset: Asset;
  time: number;
  left: number;
  width: number;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    return timelineThumbnails.subscribe(asset, time, setUrl);
  }, [asset, time]);
  return (
    <div
      className="timeline-thumbnail"
      data-source-time={time}
      style={{ left, width }}
    >
      {url && <img src={url} alt="" draggable={false} />}
    </div>
  );
}

export default memo(function TimelineFilmstrip({
  asset,
  clip,
  zoom,
  height,
  viewportLeft,
  viewportWidth,
  waveform,
}: {
  asset: Asset;
  clip: Clip;
  zoom: number;
  height: number;
  viewportLeft: number;
  viewportWidth: number;
  waveform: boolean;
}) {
  const previewHeight = Math.max(16, height - (waveform ? 20 : 0));
  const tiles = useMemo(
    () =>
      timelineFilmstripTiles(
        clip,
        asset,
        zoom,
        previewHeight,
        viewportLeft,
        viewportWidth,
      ),
    [clip, asset, zoom, previewHeight, viewportLeft, viewportWidth],
  );
  return (
    <div
      className="timeline-filmstrip"
      role="img"
      aria-label={clip.kind === "video" ? "视频画面预览" : "图片画面预览"}
      style={{ bottom: waveform ? 20 : 0 }}
    >
      {tiles.map((tile) => (
        <Tile key={`${tile.segment}:${tile.index}:${tile.time}`} asset={asset} {...tile} />
      ))}
    </div>
  );
});
