import type { Clip } from "../shared/model";
import { mediaSegments } from "../shared/media-segments";

/** Join source ranges before shared timing, animation, effects and audio processing.
 * No intermediate encoding: both streams retain their original source samples.
 */
export function stitchInputFilters(
  clip: Clip,
  input: string,
  output: string,
  audio = false,
): string[] {
  const parts = mediaSegments(clip);
  const split = audio ? "asplit" : "split";
  const trim = audio ? "atrim" : "trim";
  const pts = audio ? "asetpts" : "setpts";
  const labels = parts.map((_, index) => `${output}in${index}`);
  const filters =
    parts.length > 1
      ? [
          `[${input}]${split}=${parts.length}${labels.map((label) => `[${label}]`).join("")}`,
        ]
      : [];
  parts.forEach((part, index) => {
    const source = parts.length > 1 ? labels[index] : input;
    const chain = part.freeze
      ? audio
        ? `atrim=end_sample=1,asetpts=PTS-STARTPTS,volume=0,apad=whole_dur=${part.duration},atrim=duration=${part.duration}`
        : `trim=start=${part.sourceIn},setpts=PTS-STARTPTS,trim=end_frame=1,tpad=stop_mode=clone:stop_duration=${part.duration},trim=duration=${part.duration},setpts=PTS-STARTPTS`
      : `${trim}=start=${part.sourceIn}:duration=${part.duration},${pts}=PTS-STARTPTS`;
    filters.push(`[${source}]${chain}[${output}part${index}]`);
  });
  filters.push(
    `${parts.map((_, index) => `[${output}part${index}]`).join("")}concat=n=${parts.length}:v=${audio ? 0 : 1}:a=${audio ? 1 : 0}[${output}]`,
  );
  return filters;
}
