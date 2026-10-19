import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Asset, Clip } from "../shared/model";
import {
  waveformColumns,
  waveformLevels,
  type AudioWaveform,
} from "../shared/audio-waveform";

type PreparedWaveform = AudioWaveform & { levels: Uint8Array[] };
const cache = new Map<
  Asset,
  { promise: Promise<PreparedWaveform | null>; bytes: number; settled: boolean }
>();
const cacheBudget = 64 * 1024 * 1024;
let cachedBytes = 0;

function loadWaveform(asset: Asset) {
  if (!window.framecraft) return Promise.resolve(null);
  const cached = cache.get(asset);
  if (cached) {
    cache.delete(asset);
    cache.set(asset, cached);
    return cached.promise;
  }
  const entry = {
    bytes: 0,
    settled: false,
    promise: window.framecraft
      .mediaWaveform(asset.id)
      .then((data) => {
        const levels = data ? waveformLevels(data.peaks) : [];
        entry.settled = true;
        entry.bytes = levels.reduce((sum, level) => sum + level.byteLength, 0);
        cachedBytes += entry.bytes;
        for (const [key, value] of cache) {
          if (cachedBytes <= cacheBudget && cache.size <= 128) break;
          if (!value.settled) continue;
          cache.delete(key);
          cachedBytes -= value.bytes;
        }
        return data ? { ...data, levels } : null;
      })
      .catch((error) => {
        cache.delete(asset);
        throw error;
      }),
  };
  cache.set(asset, entry);
  return entry.promise;
}

/** Allocate only the visible strip, even when the clip is millions of pixels wide. */
export default memo(function TimelineWaveform({
  asset,
  clip,
  zoom,
  viewportLeft,
  viewportWidth,
}: {
  asset: Asset;
  clip: Clip;
  zoom: number;
  viewportLeft: number;
  viewportWidth: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [waveform, setWaveform] = useState<PreparedWaveform | null>(null);
  const [pixelRatio, setPixelRatio] = useState(
    () => window.devicePixelRatio || 1,
  );
  const left = Math.max(0, viewportLeft - clip.start * zoom - 200);
  const width = Math.max(
    0,
    Math.min(clip.duration * zoom - left, viewportWidth + 400),
  );
  useEffect(() => {
    let alive = true;
    setWaveform(null);
    if (!asset.missing)
      loadWaveform(asset)
        .then((data) => {
          if (alive) setWaveform(data);
        })
        .catch(() => {});
    return () => {
      alive = false;
    };
  }, [asset]);
  useEffect(() => {
    const query = window.matchMedia(`(resolution: ${pixelRatio}dppx)`);
    const update = () => setPixelRatio(window.devicePixelRatio || 1);
    query.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      query.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, [pixelRatio]);
  useLayoutEffect(() => {
    const node = canvas.current;
    if (!node) return;
    node.width = Math.ceil(width * pixelRatio);
    node.height = Math.ceil(20 * pixelRatio);
    const ctx = node.getContext("2d");
    if (!ctx || !waveform || !width) return;
    const columns = waveformColumns(
      waveform,
      waveform.levels,
      clip,
      asset.duration,
      zoom,
      left,
      width,
      pixelRatio,
    );
    ctx.fillStyle = "#71e6b5";
    const center = node.height / 2;
    for (let x = 0; x < columns.length; x++) {
      if (!columns[x]) continue;
      const top = Math.floor(center * (1 - columns[x] / 255));
      const bottom = Math.ceil(center * (1 + columns[x] / 255));
      ctx.fillRect(x, top, 1, bottom - top);
    }
  }, [waveform, clip, asset.duration, zoom, left, width, pixelRatio]);
  return (
    <div className="clip-waveform">
      <canvas
        ref={canvas}
        className="timeline-waveform"
        role="img"
        aria-label="音频波形"
        data-waveform-ready={waveform ? "1" : "0"}
        data-waveform-zoom={zoom}
        style={{ left, width, height: 20 }}
      />
    </div>
  );
});
