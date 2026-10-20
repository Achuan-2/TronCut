import type { Asset, Clip } from "./model";
import { mediaSegments } from "./media-segments";

function preferredTileWidth(asset: Asset, height: number) {
  const aspect = asset.height > 0 ? asset.width / asset.height : 16 / 9;
  return Math.max(48, Math.min(160, Math.round(height * aspect)));
}

/** Nested source-time grids reuse every coarse sample when zooming in. */
export function timelineFilmstripInterval(
  clip: Clip,
  asset: Asset,
  zoom: number,
  height: number,
) {
  const seconds = (preferredTileWidth(asset, height) * clip.speed) / zoom;
  return 2 ** Math.round(Math.log2(Math.max(1 / 128, seconds)));
}

/** Source-aligned tiles covering only the visible strip plus one tile. */
export function timelineFilmstripTiles(
  clip: Clip,
  asset: Asset,
  zoom: number,
  height: number,
  viewportLeft: number,
  viewportWidth: number,
  interval = timelineFilmstripInterval(clip, asset, zoom, height),
) {
  if (
    asset.missing ||
    !["video", "image"].includes(clip.kind) ||
    zoom <= 0 ||
    viewportWidth <= 0 ||
    height <= 0 ||
    !Number.isFinite(interval) ||
    interval <= 0
  )
    return [];
  const tileWidth = preferredTileWidth(asset, height);
  const clipWidth = clip.duration * zoom;
  const left = Math.max(0, viewportLeft - clip.start * zoom);
  const right = Math.min(
    clipWidth,
    viewportLeft + viewportWidth - clip.start * zoom,
  );
  if (right <= left) return [];
  const tiles: {
    index: number;
    segment: number;
    left: number;
    width: number;
    time: number;
    sourceStart: number;
    sourceEnd: number;
  }[] = [];
  // Restart at source cuts and frozen ranges. Neither exact nor temporary
  // cached images may cross a cut into footage removed from the clip.
  const parts = mediaSegments(clip);
  for (let segment = 0; segment < parts.length; segment++) {
    const part = parts[segment];
    const segmentLeft = part.start * zoom;
    const segmentRight = Math.min(
      clipWidth,
      (part.start + part.duration / clip.speed) * zoom,
    );
    if (segmentRight <= left || segmentLeft >= right) continue;
    const repeated = clip.kind === "image" || part.freeze;
    const pixelsPerSample = repeated
      ? tileWidth
      : (interval / clip.speed) * zoom;
    const visibleLeft = Math.max(segmentLeft, left - pixelsPerSample);
    const visibleRight = Math.min(segmentRight, right + pixelsPerSample);
    if (repeated) {
      const from = Math.max(
        0,
        Math.floor((visibleLeft - segmentLeft) / tileWidth),
      );
      const to = Math.ceil((visibleRight - segmentLeft) / tileWidth);
      const time = clip.kind === "image" ? 0 : part.sourceIn;
      for (let index = from; index < to && tiles.length < 128; index++) {
        const tileLeft = segmentLeft + index * tileWidth;
        tiles.push({
          index,
          segment,
          left: tileLeft,
          width: Math.min(tileWidth, segmentRight - tileLeft),
          time,
          sourceStart: time,
          sourceEnd: time,
        });
      }
    } else {
      const sourceEnd = part.sourceIn + part.duration;
      const loopDuration = clip.loop && asset.duration > 0 ? asset.duration : 0;
      let cursor =
        part.sourceIn + ((visibleLeft - segmentLeft) / zoom) * clip.speed;
      const end = Math.min(
        sourceEnd,
        part.sourceIn + ((visibleRight - segmentLeft) / zoom) * clip.speed,
      );
      while (cursor < end - 1e-8 && tiles.length < 128) {
        // Restart the same source grid at each loop, including non-integer
        // source durations, instead of generating different frames per cycle.
        const cycle = loopDuration
          ? Math.floor((cursor + 1e-8) / loopDuration) * loopDuration
          : 0;
        const sample =
          Math.floor((cursor - cycle + 1e-8) / interval) * interval;
        const from = Math.max(part.sourceIn, cycle + sample);
        const to = Math.min(
          sourceEnd,
          cycle + sample + interval,
          loopDuration ? cycle + loopDuration : Infinity,
        );
        if (to <= cursor + 1e-8) break;
        const tileLeft =
          segmentLeft + ((from - part.sourceIn) / clip.speed) * zoom;
        const time = Math.max(
          0,
          Math.min(
            from === part.sourceIn ? from - cycle : sample,
            Math.max(0, asset.duration - 0.001),
          ),
        );
        tiles.push({
          index: from,
          segment,
          left: tileLeft,
          width: Math.min(
            segmentRight - tileLeft,
            ((to - from) / clip.speed) * zoom,
          ),
          time,
          sourceStart: loopDuration ? 0 : part.sourceIn,
          sourceEnd: loopDuration ? asset.duration : sourceEnd,
        });
        cursor = to;
      }
    }
    if (tiles.length >= 128) break;
  }
  return tiles;
}
