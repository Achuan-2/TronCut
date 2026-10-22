import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import "mathjax-full/js/input/tex/ams/AmsConfiguration.js";
import "mathjax-full/js/input/tex/color/ColorConfiguration.js";
import "mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js";
import type { TextStyle } from "./model";

export type MathTextToken = {
  start: number;
  end: number;
  tex?: string;
  contentStart?: number;
  display?: boolean;
};
export type FormulaGraphic = { svg: string; width: number; height: number };
const tokenCache = new Map<string, MathTextToken[]>();

function escaped(text: string, offset: number) {
  let slashes = 0;
  while (offset > 0 && text[--offset] === "\\") slashes++;
  return slashes % 2 === 1;
}

/** Offsets always address the editable source, including the math delimiters. */
export function mathTextTokens(text: string): MathTextToken[] {
  const cached = tokenCache.get(text);
  if (cached) return cached;
  const tokens: MathTextToken[] = [];
  let plainStart = 0;
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== "$" || escaped(text, start)) continue;
    const display = text[start + 1] === "$";
    const delimiter = display ? "$$" : "$";
    const contentStart = start + delimiter.length;
    if (!display && /\s/.test(text[contentStart] ?? " ")) continue;
    let end = contentStart;
    while ((end = text.indexOf(delimiter, end)) !== -1) {
      if (escaped(text, end) || (!display && /\d/.test(text[end + 1] ?? ""))) {
        end += delimiter.length;
        continue;
      }
      break;
    }
    const content = end < 0 ? "" : text.slice(contentStart, end);
    if (
      !content.trim() ||
      (!display && (/\n/.test(content) || /\s$/.test(content)))
    ) {
      if (display) start++;
      continue;
    }
    if (start > plainStart) tokens.push({ start: plainStart, end: start });
    tokens.push({
      start,
      end: end + delimiter.length,
      tex: content.trim(),
      contentStart: contentStart + content.search(/\S/),
      display,
    });
    start = end + delimiter.length - 1;
    plainStart = start + 1;
  }
  if (plainStart < text.length)
    tokens.push({ start: plainStart, end: text.length });
  if (tokenCache.size >= 128)
    tokenCache.delete(tokenCache.keys().next().value!);
  tokenCache.set(text, tokens);
  return tokens;
}

export const hasMathText = (text = "") =>
  mathTextTokens(text).some((token) => token.tex !== undefined);

function createRenderer() {
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const convert = (tex: string, display: boolean) => {
    // Each expression has its own macro/color definitions, independent of cache order.
    const document = mathjax.document("", {
      InputJax: new TeX({
        packages: ["base", "ams", "color", "newcommand"],
        maxBuffer: 10000,
        maxMacros: 1000,
        formatError: (_jax: unknown, error: Error) => {
          throw error;
        },
      }),
      OutputJax: new SVG({ fontCache: "none" }),
    });
    return document.convert(tex, {
      display,
      em: 1000,
      ex: 442,
      containerWidth: 80000,
    });
  };
  return { adaptor, convert };
}
let renderer: ReturnType<typeof createRenderer> | undefined;
const formulaCache = new Map<
  string,
  { svg: string; viewBox: number[] } | null
>();

function formulaShape(tex: string, display: boolean) {
  const key = JSON.stringify([tex, display]);
  if (!formulaCache.has(key)) {
    let value: { svg: string; viewBox: number[] } | null = null;
    try {
      renderer ??= createRenderer();
      const { adaptor, convert } = renderer;
      const node = convert(tex, display);
      const container = adaptor.outerHTML(node);
      const svg = container.slice(
        container.indexOf("<svg"),
        container.lastIndexOf("</svg>") + 6,
      );
      const viewBox = /viewBox="([^"]+)"/
        .exec(svg)?.[1]
        .split(/\s+/)
        .map(Number);
      if (
        viewBox?.length === 4 &&
        viewBox.every(Number.isFinite) &&
        viewBox[2] > 0 &&
        viewBox[3] > 0 &&
        !svg.includes('data-mml-node="merror"')
      )
        value = { svg, viewBox };
    } catch {
      // Incomplete or invalid TeX remains editable ordinary text.
    }
    if (formulaCache.size >= 256)
      formulaCache.delete(formulaCache.keys().next().value!);
    formulaCache.set(key, value);
  }
  return formulaCache.get(key) ?? null;
}

/** Whole-object and per-unit behaviors must use the same visual unit count. */
export function mathTextBehaviorSource(text: string) {
  return mathTextTokens(text)
    .map((token) =>
      token.tex !== undefined && formulaShape(token.tex, !!token.display)
        ? "\ufffc"
        : text.slice(token.start, token.end),
    )
    .join("");
}

/** Self-contained paths work offline in Chromium and Sharp, without font files. */
export function renderFormula(
  tex: string,
  display: boolean,
  style: TextStyle,
): FormulaGraphic | null {
  const value = formulaShape(tex, display);
  if (!value) return null;
  const [x, y, width, height] = value.viewBox;
  const padding = (style.outlineWidth / style.fontSize) * 1000 + 2;
  const pixelWidth = ((width + padding * 2) * style.fontSize) / 1000;
  const pixelHeight = ((height + padding * 2) * style.fontSize) / 1000;
  const svg = value.svg
    .replace(/width="[^"]+"/, `width="${pixelWidth}"`)
    .replace(/height="[^"]+"/, `height="${pixelHeight}"`)
    .replace(
      /viewBox="[^"]+"/,
      `viewBox="${x - padding} ${y - padding} ${width + padding * 2} ${height + padding * 2}"`,
    )
    .replace(/currentColor/g, style.color)
    .replace(
      /<(path|rect|polygon)\b/g,
      `<$1 stroke="${style.outline}" stroke-width="${(style.outlineWidth * 2000) / style.fontSize}" stroke-linejoin="round" paint-order="stroke fill"`,
    );
  return { svg, width: pixelWidth, height: pixelHeight };
}

export const formulaDataUrl = (formula: FormulaGraphic) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(formula.svg)}`;
