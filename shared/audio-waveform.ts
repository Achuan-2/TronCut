import type { Clip } from "./model";
import { mediaSegments } from "./media-segments";

export interface AudioWaveform {
  peaksPerSecond: number;
  /** Symmetric peak envelope, square-root scaled to preserve quiet passages. */
  peaks: Uint8Array;
}

export function waveformLevels(peaks: Uint8Array): Uint8Array[] {
  const levels = [peaks];
  while (peaks.length > 1) {
    const next = new Uint8Array(Math.ceil(peaks.length / 2));
    for (let i = 0; i < next.length; i++)
      next[i] = Math.max(peaks[i * 2], peaks[i * 2 + 1] ?? 0);
    levels.push(next);
    peaks = next;
  }
  return levels;
}

function peakBetween(levels: Uint8Array[], from: number, to: number) {
  let peak = 0;
  let start = Math.max(0, Math.floor(from + 1e-8));
  let end = Math.min(levels[0].length, Math.ceil(to - 1e-8));
  // Query the exact range through the peak pyramid so trimmed-out transients
  // cannot bleed into a pixel at coarse zoom levels.
  for (let level = 0; start < end; level++) {
    if (start % 2) peak = Math.max(peak, levels[level][start++]);
    if (end % 2) peak = Math.max(peak, levels[level][--end]);
    start = Math.floor(start / 2);
    end = Math.floor(end / 2);
  }
  return peak;
}

/** One amplitude per device pixel; each source sample keeps its timeline position. */
export function waveformColumns(
  waveform: AudioWaveform,
  levels: Uint8Array[],
  clip: Clip,
  assetDuration: number,
  zoom: number,
  left: number,
  width: number,
  pixelRatio: number,
): Uint8Array {
  const count = Math.max(0, Math.ceil(width * pixelRatio));
  const columns = new Uint8Array(count);
  const pixelsPerSecond = zoom * pixelRatio;
  const rate = waveform.peaksPerSecond;
  const parts = mediaSegments(clip);
  let partIndex = 0;
  for (let x = 0; x < count; x++) {
    const time = left / zoom + x / pixelsPerSecond;
    while (
      partIndex < parts.length &&
      time >=
        parts[partIndex].start + parts[partIndex].duration / clip.speed - 1e-9
    )
      partIndex++;
    if (partIndex >= parts.length) break;
    const pixelEnd = time + 1 / pixelsPerSecond;
    // A pixel can straddle a stitch seam. Include both source ranges, not the gap.
    for (
      let i = partIndex;
      i < parts.length && parts[i].start < pixelEnd;
      i++
    ) {
      const part = parts[i];
      if (part.freeze) continue;
      const source =
        part.sourceIn + (Math.max(time, part.start) - part.start) * clip.speed;
      const end = Math.min(
        part.sourceIn + part.duration,
        part.sourceIn + (pixelEnd - part.start) * clip.speed,
      );
      let peak: number;
      if (clip.loop && assetDuration > 0) {
        const from = ((source % assetDuration) + assetDuration) % assetDuration;
        const to = from + end - source;
        peak =
          end - source >= assetDuration
            ? (levels.at(-1)![0] ?? 0)
            : to <= assetDuration
              ? peakBetween(levels, from * rate, to * rate)
              : Math.max(
                  peakBetween(levels, from * rate, assetDuration * rate),
                  peakBetween(levels, 0, (to - assetDuration) * rate),
                );
      } else peak = peakBetween(levels, source * rate, end * rate);
      columns[x] = Math.max(columns[x], peak);
    }
  }
  return columns;
}
