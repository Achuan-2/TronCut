import { memo, useEffect, useMemo, useState } from "react";
import type { Asset, Clip } from "../shared/model";
import {
  timelineFilmstripInterval,
  timelineFilmstripTiles,
} from "../shared/timeline-filmstrip";
import { timelineThumbnails } from "./timeline-thumbnails";

function Tile({
  asset,
  time,
  left,
  width,
  sourceStart,
  sourceEnd,
}: {
  asset: Asset;
  time: number;
  left: number;
  width: number;
  sourceStart: number;
  sourceEnd: number;
}) {
  const [image, setImage] = useState(() => ({
    asset,
    time,
    exact: false,
    url: timelineThumbnails.cached(asset, time, sourceStart, sourceEnd),
  }));
  const url =
    image.asset === asset && image.time === time
      ? image.url
      : timelineThumbnails.cached(asset, time, sourceStart, sourceEnd);
  useEffect(() => {
    return timelineThumbnails.subscribe(asset, time, (url) => {
      setImage({
        asset,
        time,
        exact: url !== null,
        url:
          url ?? timelineThumbnails.cached(asset, time, sourceStart, sourceEnd),
      });
    });
  }, [asset, time, sourceStart, sourceEnd]);
  return (
    <div
      className="timeline-thumbnail"
      data-source-time={time}
      data-thumbnail-ready={
        image.asset === asset && image.time === time && image.exact ? "1" : "0"
      }
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
  const requestedInterval = timelineFilmstripInterval(
    clip,
    asset,
    zoom,
    previewHeight,
  );
  const [settledInterval, setSettledInterval] = useState(requestedInterval);
  useEffect(() => {
    // Resize cached tiles during a zoom gesture. Request a finer grid only
    // after it settles; zooming out immediately uses the cached coarse subset.
    const timer = window.setTimeout(
      () => setSettledInterval(requestedInterval),
      140,
    );
    return () => window.clearTimeout(timer);
  }, [requestedInterval, zoom, previewHeight]);
  const interval = Math.max(requestedInterval, settledInterval);
  const tiles = useMemo(
    () =>
      timelineFilmstripTiles(
        clip,
        asset,
        zoom,
        previewHeight,
        viewportLeft,
        viewportWidth,
        interval,
      ),
    [clip, asset, zoom, previewHeight, viewportLeft, viewportWidth, interval],
  );
  return (
    <div
      className="timeline-filmstrip"
      role="img"
      aria-label={clip.kind === "video" ? "视频画面预览" : "图片画面预览"}
      style={{ bottom: waveform ? 20 : 0 }}
    >
      {tiles.map((tile) => (
        <Tile
          key={`${tile.segment}:${tile.index}:${tile.time}`}
          asset={asset}
          {...tile}
        />
      ))}
    </div>
  );
});
