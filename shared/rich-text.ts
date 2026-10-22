import type { CharacterStyle, Clip, TextStyle } from "./model";
import { textGlyphs } from "./behaviors";
import {
  mathTextTokens,
  renderFormula,
  type FormulaGraphic,
  type MathTextToken,
} from "./math-text";

export type TextRange = { start: number; end: number };
type TextRun = NonNullable<Clip["textRuns"]>[number];
export const characterStyleKeys = [
  "fontFamily",
  "fontSize",
  "bold",
  "italic",
  "underline",
  "color",
  "outline",
  "outlineWidth",
] as const;
const sameStyle = (a: CharacterStyle, b: CharacterStyle) =>
  characterStyleKeys.every((key) => a[key] === b[key]);

/** A complete, ordered partition, including gaps inheriting the base style. */
export function textSegments(clip: Pick<Clip, "text" | "textRuns">): TextRun[] {
  const length = (clip.text ?? "").length;
  const result: TextRun[] = [];
  let cursor = 0;
  for (const run of [...(clip.textRuns ?? [])].sort(
    (a, b) => a.start - b.start,
  )) {
    const start = Math.max(cursor, Math.min(length, run.start));
    const end = Math.min(length, run.end);
    if (end <= start) continue;
    if (start > cursor) result.push({ start: cursor, end: start, style: {} });
    result.push({ start, end, style: run.style });
    cursor = end;
  }
  if (cursor < length) result.push({ start: cursor, end: length, style: {} });
  return result;
}

function compact(runs: TextRun[]): Clip["textRuns"] {
  const result: TextRun[] = [];
  for (const run of runs) {
    if (run.end <= run.start || !Object.keys(run.style).length) continue;
    const last = result.at(-1);
    if (last?.end === run.start && sameStyle(last.style, run.style))
      last.end = run.end;
    else result.push({ ...run });
  }
  return result.length ? result : undefined;
}

export function applyCharacterStyle(
  clip: Clip,
  range: TextRange | null,
  patch: CharacterStyle,
): Clip {
  const start = Math.max(0, range?.start ?? 0);
  const end = Math.min((clip.text ?? "").length, range?.end ?? Infinity);
  const runs = textSegments(clip).flatMap((run): TextRun[] => {
    if (run.end <= start || run.start >= end) return [run];
    const style = { ...run.style };
    for (const key of characterStyleKeys) {
      if (patch[key] !== undefined) delete style[key];
    }
    return [
      { ...run, end: Math.min(run.end, start) },
      {
        start: Math.max(run.start, start),
        end: Math.min(run.end, end),
        style: range ? { ...style, ...patch } : style,
      },
      { ...run, start: Math.max(run.start, end) },
    ];
  });
  return {
    ...clip,
    style: range ? clip.style : { ...clip.style!, ...patch },
    textRuns: compact(runs),
  };
}

/** Shift unaffected spans and inherit the insertion point when replacing text. */
export function reconcileTextRuns(before: Clip, next: Clip): Clip {
  const oldText = before.text ?? "",
    text = next.text ?? "";
  if (
    oldText === text ||
    !before.textRuns?.length ||
    before.textRuns !== next.textRuns
  )
    return next;
  let start = 0,
    suffix = 0;
  while (
    start < oldText.length &&
    start < text.length &&
    oldText[start] === text[start]
  )
    start++;
  while (
    suffix < oldText.length - start &&
    suffix < text.length - start &&
    oldText[oldText.length - suffix - 1] === text[text.length - suffix - 1]
  )
    suffix++;
  const oldEnd = oldText.length - suffix,
    newEnd = text.length - suffix;
  const segments = textSegments(before);
  const inherited =
    segments.find((run) => run.start <= start && run.end > start)?.style ??
    segments.at(-1)?.style ??
    {};
  const runs: TextRun[] = [];
  for (const run of segments) {
    if (run.start < start) runs.push({ ...run, end: Math.min(run.end, start) });
    if (run.end > oldEnd)
      runs.push({
        ...run,
        start: Math.max(run.start, oldEnd) + newEnd - oldEnd,
        end: run.end + newEnd - oldEnd,
      });
  }
  if (newEnd > start) runs.push({ start, end: newEnd, style: inherited });
  return { ...next, textRuns: compact(runs.sort((a, b) => a.start - b.start)) };
}

export function characterStyleAt(clip: Clip, offset: number): TextStyle {
  const run = clip.textRuns?.find(
    (run) => run.start <= offset && run.end > offset,
  );
  return { ...clip.style!, ...run?.style };
}

export type StyledGlyph = {
  text: string;
  x: number;
  y: number;
  width: number;
  index: number;
  style: TextStyle;
  formula?: FormulaGraphic;
};
/** Shared geometry for normal text, per-character motion and exported textures. */
export function layoutStyledText(
  clip: Clip,
  measure: (text: string, style: TextStyle) => number,
) {
  const tokens = mathTextTokens(clip.text ?? "");
  if (tokens.some((token) => token.tex !== undefined))
    return layoutMathText(clip, measure, tokens);
  const glyphs: StyledGlyph[] = [];
  const rows: { glyphs: StyledGlyph[]; width: number; height: number }[] = [];
  let offset = 0,
    index = 0;
  for (const line of (clip.text ?? "").split("\n")) {
    const row = {
      glyphs: [] as StyledGlyph[],
      width: 0,
      height: (clip.style?.fontSize ?? 68) * 1.25,
    };
    let prefix = "",
      previous: TextStyle | undefined,
      runLeft = 0;
    for (const text of textGlyphs(line)) {
      const style = characterStyleAt(clip, offset);
      if (!previous || !sameStyle(previous, style)) {
        prefix = "";
        runLeft = row.width;
      }
      const width = measure(text, style);
      const glyph = {
        text,
        x: runLeft + measure(prefix, style) + width / 2,
        y: 0,
        width,
        index: index++,
        style,
      };
      row.glyphs.push(glyph);
      prefix += text;
      row.width = runLeft + measure(prefix, style);
      row.height = Math.max(row.height, style.fontSize * 1.25);
      previous = style;
      offset += text.length;
    }
    rows.push(row);
    offset++;
  }
  const width = Math.max(16, ...rows.map((row) => row.width));
  let height = 0;
  for (const row of rows) {
    for (const glyph of row.glyphs)
      glyphs.push({
        ...glyph,
        x: glyph.x + (width - row.width) / 2,
        y: height + row.height / 2,
      });
    height += row.height;
  }
  return { width, height: Math.max(16, height), glyphs, count: index };
}

/** A formula is one visual unit for text behaviors; raw source offsets stay intact. */
function layoutMathText(
  clip: Clip,
  measure: (text: string, style: TextStyle) => number,
  tokens: MathTextToken[],
) {
  const text = clip.text ?? "";
  const rows: { glyphs: StyledGlyph[]; width: number; height: number }[] = [];
  const newRow = () => ({
    glyphs: [] as StyledGlyph[],
    width: 0,
    height: (clip.style?.fontSize ?? 68) * 1.25,
  });
  let row = newRow(),
    index = 0,
    prefix = "",
    runLeft = 0;
  let previous: TextStyle | undefined,
    afterDisplay = false;
  const flush = () => {
    rows.push(row);
    row = newRow();
    prefix = "";
    previous = undefined;
    runLeft = 0;
  };
  const plain = (start: number, end: number) => {
    let offset = start;
    for (const character of textGlyphs(text.slice(start, end))) {
      if (character === "\n") {
        if (!afterDisplay) flush();
        afterDisplay = false;
      } else {
        afterDisplay = false;
        const style = characterStyleAt(clip, offset);
        if (!previous || !sameStyle(previous, style)) {
          prefix = "";
          runLeft = row.width;
        }
        const width = measure(character, style);
        row.glyphs.push({
          text: character,
          x: runLeft + measure(prefix, style) + width / 2,
          y: 0,
          width,
          index: index++,
          style,
        });
        prefix += character;
        row.width = runLeft + measure(prefix, style);
        row.height = Math.max(row.height, style.fontSize * 1.25);
        previous = style;
      }
      offset += character.length;
    }
  };
  for (const token of tokens) {
    const style = characterStyleAt(clip, token.contentStart ?? token.start);
    const formula =
      token.tex === undefined
        ? null
        : renderFormula(token.tex, !!token.display, style);
    if (!formula) {
      plain(token.start, token.end);
      continue;
    }
    if (token.display && row.glyphs.length) flush();
    row.glyphs.push({
      text: text.slice(token.start, token.end),
      x: row.width + formula.width / 2,
      y: 0,
      width: formula.width,
      index: index++,
      style,
      formula,
    });
    row.width += formula.width;
    row.height = Math.max(row.height, formula.height + style.fontSize * 0.15);
    previous = undefined;
    if (token.display) {
      flush();
      afterDisplay = true;
    }
  }
  if (row.glyphs.length || !rows.length || !afterDisplay) rows.push(row);
  const width = Math.max(16, ...rows.map((row) => row.width));
  const glyphs: StyledGlyph[] = [];
  let height = 0;
  for (const row of rows) {
    for (const glyph of row.glyphs)
      glyphs.push({
        ...glyph,
        x: glyph.x + (width - row.width) / 2,
        y: height + row.height / 2,
      });
    height += row.height;
  }
  return { width, height: Math.max(16, height), glyphs, count: index };
}
