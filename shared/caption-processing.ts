import { z } from "zod";
import type { Cue } from "./subtitles";

export const captionProcessingSchema = z.object({
  segmentation: z
    .enum(["standard", "ai", "custom", "unlimited"])
    .default("standard"),
  maxChars: z.number().int().min(8).max(120).default(22),
  refinement: z.enum(["none", "correct", "polish"]).default("none"),
  instruction: z.string().trim().max(2000).default(""),
});
export type CaptionProcessingOptions = z.infer<typeof captionProcessingSchema>;
export const cueSchema = z
  .object({
    start: z.number().finite().nonnegative(),
    end: z.number().finite().positive(),
    text: z.string().max(20000),
    words: z
      .array(
        z.object({
          start: z.number().finite().nonnegative(),
          end: z.number().finite().positive(),
          text: z.string().max(20000),
        }),
      )
      .max(20000)
      .optional(),
  })
  .refine((cue) => cue.end > cue.start, "字幕结束时间必须晚于开始时间");
export interface CaptionProcessingResult {
  cues: Cue[];
  warnings: string[];
}

const wordSegmenter = new Intl.Segmenter("zh", { granularity: "word" });
const sentenceEnd = /[。！？!?；;\n.][”’"'」』）)\s]*$/u;
const contentLength = (text: string) =>
  Array.from(text.replace(/[\s\p{P}]/gu, "")).length;
const displayLength = (text: string) =>
  Array.from(text).reduce(
    (sum, char) =>
      sum + (/\s/u.test(char) ? 0.25 : /[\x00-\xff]/u.test(char) ? 0.5 : 1),
    0,
  );

/** Choose complete words and natural clauses instead of cutting every N characters.
 * Standard mode uses screen width; custom mode retains the requested character cap. */
export function splitCaptionText(
  text: string,
  limit: number,
  standard = false,
): string[] {
  const units: string[] = [];
  for (const { segment, isWordLike } of wordSegmenter.segment(text)) {
    if (!isWordLike && !/[（(“「『]/u.test(segment) && units.length)
      units[units.length - 1] += segment;
    else units.push(segment);
  }
  const length = standard
    ? displayLength
    : (value: string) => Array.from(value.trim()).length;
  const cap = standard ? limit * 1.2 : limit;
  const parts: string[] = [];
  let offset = 0;
  while (offset < units.length) {
    let end = offset,
      current = "";
    // Sentence punctuation always ends a cue; commas remain candidates.
    while (end < units.length) {
      const next = current + units[end];
      if (current.trim() && length(next) > cap) break;
      current = next;
      end++;
      if (sentenceEnd.test(units[end - 1])) break;
    }
    if (end === units.length || sentenceEnd.test(units[end - 1] ?? "")) {
      parts.push(current.trim());
      offset = end;
      continue;
    }
    let best = end,
      bestScore = -Infinity;
    for (let boundary = offset + 1; boundary <= end; boundary++) {
      const before = units.slice(offset, boundary).join("").trim();
      const after = units.slice(boundary).join("").trim();
      if (!before || !after) continue;
      // Do not detach a closing mark or break multiword product names.
      if (
        /^[，。！？、,;:!?）)」』”]/u.test(after) ||
        /[（(「『“]$/u.test(before)
      )
        continue;
      const previousWord = units[boundary - 1].trim();
      if (
        /^[A-Z][A-Za-z\d-]*$/u.test(previousWord) &&
        /^[A-Z][A-Za-z\d-]*/u.test(after)
      )
        continue;
      const size = length(before);
      let score = -Math.abs(size - limit * 0.8);
      if (/[，,：:、]$/u.test(before)) score += limit * 0.7;
      if (
        /^(?:让|然后|接下来|但是|所以|如果|因为|而且|你就|也可以|指定)/u.test(
          after,
        )
      )
        score += limit * 0.45;
      if (/[的把被和与及给让在为向从跟将对到]$/u.test(before))
        score -= limit * 0.8;
      if (contentLength(before) < 5 || contentLength(after) < 4) score -= limit;
      if (score > bestScore) {
        best = boundary;
        bestScore = score;
      }
    }
    const part = units.slice(offset, best).join("").trim();
    if (part) parts.push(part);
    offset = best;
  }
  return parts.filter(Boolean).reduce<string[]>((result, part) => {
    if (result.length && /^[\p{P}\p{S}]+$/u.test(part))
      result[result.length - 1] += part;
    else result.push(part);
    return result;
  }, []);
}

/** Without word timestamps, estimate only within each original speech interval. */
export function distributeCaptionParts(cue: Cue, parts: string[]): Cue[] {
  if (!parts.length) return [cue];
  const normalized = (text: string) => text.replace(/\s/gu, "");
  const words = cue.words;
  const aligned =
    words?.length &&
    normalized(words.map((word) => word.text).join("")) ===
      normalized(cue.text) &&
    words.every(
      (word, index) =>
        word.start >= cue.start &&
        word.end <= cue.end &&
        word.end > word.start &&
        (!index || word.start >= words[index - 1].start),
    );
  if (aligned) {
    let consumed = 0,
      cursor = 0;
    const ranges = words.map((word) => {
      const start = cursor;
      cursor += normalized(word.text).length;
      return { ...word, from: start, to: cursor };
    });
    const timed = parts.map((text) => {
      const from = consumed;
      consumed += normalized(text).length;
      const first = ranges.find((word) => word.to > from);
      const last = [...ranges].reverse().find((word) => word.from < consumed);
      return first && last ? { start: first.start, end: last.end, text } : null;
    });
    // A model token may span a linguistic boundary; estimate instead of overlapping cues.
    if (
      timed.every(
        (part, index) =>
          part && (!index || part.start >= timed[index - 1]!.end),
      )
    )
      return timed as Cue[];
  }
  const weights = parts.map((part) =>
    Math.max(1, Array.from(part).filter((c) => !/\s/u.test(c)).length),
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let consumed = 0;
  return parts.map((text, index) => {
    const start = cue.start + ((cue.end - cue.start) * consumed) / total;
    consumed += weights[index];
    return {
      start,
      end:
        index === parts.length - 1
          ? cue.end
          : cue.start + ((cue.end - cue.start) * consumed) / total,
      text,
    };
  });
}

export function segmentCaptionCues(
  cues: Cue[],
  options: CaptionProcessingOptions,
): Cue[] {
  if (options.segmentation === "unlimited") return cues;
  const limit = options.segmentation === "custom" ? options.maxChars : 22;
  return cues.flatMap((cue) =>
    distributeCaptionParts(
      cue,
      splitCaptionText(cue.text, limit, options.segmentation !== "custom"),
    ),
  );
}
