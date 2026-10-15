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
  })
  .refine((cue) => cue.end > cue.start, "字幕结束时间必须晚于开始时间");
export interface CaptionProcessingResult {
  cues: Cue[];
  warnings: string[];
}

/** Punctuation stays with the preceding sentence; Latin words stay intact. */
export function splitCaptionText(text: string, limit: number): string[] {
  const units =
    text.match(
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*|[^\p{L}\p{N}]/gu,
    ) ?? [];
  const parts: string[] = [];
  let current = "";
  const flush = () => {
    if (current.trim()) parts.push(current.trim());
    current = "";
  };
  for (const unit of units) {
    const punctuation = /^[\s\p{P}\p{S}]+$/u.test(unit);
    if (
      current.trim() &&
      !punctuation &&
      Array.from(current + unit).length > limit
    )
      flush();
    current += unit;
    if (
      /[。！？!?；;\n]$/u.test(unit) ||
      (/[，,]$/.test(unit) &&
        Array.from(current.trim()).length >= Math.floor(limit * 0.6))
    )
      flush();
  }
  flush();
  // Avoid a last punctuation-only caption after quotes or repeated punctuation.
  return parts.reduce<string[]>((result, part) => {
    if (result.length && /^[\p{P}\p{S}]+$/u.test(part))
      result[result.length - 1] += part;
    else result.push(part);
    return result;
  }, []);
}

/** Without word timestamps, estimate only within each original speech interval. */
export function distributeCaptionParts(cue: Cue, parts: string[]): Cue[] {
  if (!parts.length) return [cue];
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
    distributeCaptionParts(cue, splitCaptionText(cue.text, limit)),
  );
}
