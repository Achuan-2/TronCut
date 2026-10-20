import type { Asset, Clip } from "./model";
import { mediaSegments } from "./media-segments";

/** Small, source-aligned tiles covering only the visible strip plus one tile. */
export function timelineFilmstripTiles(
  clip: Clip,
  asset: Asset,
  zoom: number,
  height: number,
  viewportLeft: number,
  viewportWidth: number,
) {
  if (
    asset.missing ||
    !["video", "image"].includes(clip.kind) ||
    zoom <= 0 ||
    viewportWidth <= 0 ||
    height <= 0
  )
    return [];
  const aspect = asset.height > 0 ? asset.width / asset.height : 16 / 9;
  const tileWidth = Math.max(48, Math.min(160, Math.round(height * aspect)));
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
  }[] = [];
  // Restart at source cuts and frozen ranges so a tile cannot show the preceding
  // moving frame over a freeze region or bridge material removed by a stitch.
  const parts = mediaSegments(clip);
  for (let segment = 0; segment < parts.length; segment++) {
    const part = parts[segment];
    const segmentLeft = part.start * zoom;
    const segmentRight = Math.min(
      clipWidth,
      (part.start + part.duration / clip.speed) * zoom,
    );
    if (segmentRight <= left || segmentLeft >= right) continue;
    const from = Math.max(
      0,
      Math.floor((Math.max(left, segmentLeft) - segmentLeft) / tileWidth) - 1,
    );
    const to = Math.min(
      Math.ceil((segmentRight - segmentLeft) / tileWidth),
      Math.ceil((Math.min(right, segmentRight) - segmentLeft) / tileWidth) + 1,
    );
    for (let index = from; index < to && tiles.length < 128; index++) {
      const tileLeft = segmentLeft + index * tileWidth;
      let time =
        clip.kind === "image"
          ? 0
          : part.sourceIn +
            (part.freeze ? 0 : ((index * tileWidth) / zoom) * clip.speed);
      if (clip.loop && asset.duration > 0) time %= asset.duration;
      // 100 ms sampling shares cache entries across nearby zoom/scroll positions.
      time = Math.max(
        0,
        Math.min(
          Math.floor((time + 1e-8) * 10) / 10,
          Math.max(0, asset.duration - 0.001),
        ),
      );
      tiles.push({
        index,
        segment,
        left: tileLeft,
        width: Math.min(tileWidth, segmentRight - tileLeft),
        time,
      });
    }
    if (tiles.length >= 128) break;
  }
  return tiles;
}
