import type ParseOptions from "mathjax-full/js/input/tex/ParseOptions.js";
import type TexParser from "mathjax-full/js/input/tex/TexParser.js";
import type { TextNode } from "mathjax-full/js/core/MmlTree/MmlNode.js";

export type FormulaColor = { start: number; end: number; color: string };

type Source = { text: string; offsets: number[] };

/** Track MathJax's source positions instead of inserting commands into TeX.
 * Inserting color commands can consume unbraced arguments or break scripts.
 * These hooks belong to one conversion, never to the global parser prototype.
 */
export function applyFormulaColors(
  options: ParseOptions,
  colors: FormulaColor[],
) {
  const sources = new WeakMap<TexParser, Source>();
  const argumentsByParser = new WeakMap<TexParser, Source[]>();
  const pushParser = options.pushParser.bind(options);
  options.pushParser = (parser) => {
    const parent = options.parser;
    const args = parent && argumentsByParser.get(parent);
    let argumentIndex = (args?.length ?? 0) - 1;
    while (argumentIndex >= 0 && args![argumentIndex].text !== parser.string)
      argumentIndex--;
    const source =
      argumentIndex >= 0
        ? args!.splice(argumentIndex, 1)[0]
        : {
            text: parser.string,
            offsets: Array.from({ length: parser.string.length }, (_, i) =>
              parent ? (sources.get(parent)?.offsets[parent.i - 1] ?? -1) : i,
            ),
          };
    sources.set(parser, source);
    argumentsByParser.set(parser, []);
    let atomStart = 0;

    // MathJax expands macros (and inserts spaces after numeric scripts) by
    // replacing parser.string. Keep the unchanged prefix/suffix source mapping.
    Object.defineProperty(parser, "string", {
      get: () => source.text,
      set: (text: string) => {
        let start = 0,
          suffix = 0;
        while (
          start < source.text.length &&
          start < text.length &&
          source.text[start] === text[start]
        )
          start++;
        while (
          suffix < source.text.length - start &&
          suffix < text.length - start &&
          source.text[source.text.length - suffix - 1] ===
            text[text.length - suffix - 1]
        )
          suffix++;
        const inherited =
          source.offsets[Math.max(start, atomStart)] ??
          source.offsets[start - 1] ??
          -1;
        source.offsets = [
          ...source.offsets.slice(0, start),
          ...Array<number>(text.length - start - suffix).fill(inherited),
          ...source.offsets.slice(source.text.length - suffix),
        ];
        source.text = text;
      },
    });

    const rememberArgument = <T extends string | null>(read: () => T): T => {
      const start = parser.i;
      const result = read();
      if (typeof result === "string") {
        const offset = parser.string.indexOf(result, start);
        if (offset >= start && offset + result.length <= parser.i)
          argumentsByParser.get(parser)!.push({
            text: result,
            offsets: source.offsets.slice(offset, offset + result.length),
          });
      }
      return result;
    };
    const getArgument = parser.GetArgument.bind(parser);
    parser.GetArgument = (name, noneOK) =>
      rememberArgument(() => getArgument(name, noneOK));
    const getBrackets = parser.GetBrackets.bind(parser);
    parser.GetBrackets = (name, fallback) =>
      rememberArgument(() => getBrackets(name, fallback));
    const getUpTo = parser.GetUpTo.bind(parser);
    parser.GetUpTo = (name, token) =>
      rememberArgument(() => getUpTo(name, token));

    const parse = parser.parse.bind(parser);
    parser.parse = (kind, input) => {
      if (kind === "character") atomStart = parser.i - input[1].length;
      return parse(kind, input);
    };
    const create = parser.create.bind(parser);
    parser.create = (kind, ...rest) => {
      const node = create(kind, ...rest);
      if (!node.isToken && !["mfrac", "msqrt", "mroot"].includes(rest[0]))
        return node;
      const colorAt = (offset: number) =>
        colors.find((run) => run.start <= offset && offset < run.end)?.color;
      // A command is one visible symbol even if the selection omits its slash.
      const command = /^\\(?:[a-z]+|.)/i.exec(source.text.slice(atomStart));
      const color = source.offsets
        .slice(atomStart, atomStart + (command?.[0].length ?? 1))
        .map(colorAt)
        .find((value) => value !== undefined);
      const defaultColor =
        node.attributes.getExplicit("mathcolor") ??
        parser.stack.env.color ??
        "currentColor";
      // A colored fraction bar/radical must not recolor unselected children.
      node.attributes.set("mathcolor", color ?? defaultColor);

      // MathJax combines numbers and \\text contents into one token. Preserve
      // local colors even when the selection covers only part of that token.
      const content = node.isToken
        ? node.childNodes.map((child) => (child as TextNode).getText()).join("")
        : "";
      if (content.length > 1) {
        const argument = [...(argumentsByParser.get(parser) ?? [])]
          .reverse()
          .find((arg) => arg.text === content);
        const offsets =
          argument?.offsets ??
          source.offsets.slice(atomStart, atomStart + content.length);
        const literal =
          argument?.text ??
          source.text.slice(atomStart, atomStart + content.length);
        if (literal === content) {
          const pieces: { text: string; color: string | undefined }[] = [];
          let offset = 0;
          for (const character of content) {
            const color = colorAt(offsets[offset]);
            const previous = pieces.at(-1);
            if (previous && previous.color === color)
              previous.text += character;
            else pieces.push({ text: character, color });
            offset += character.length;
          }
          if (pieces.length > 1)
            return create(
              "node",
              "mrow",
              pieces.map((piece) =>
                create(
                  "token",
                  rest[0],
                  {
                    ...(kind === "token" ? rest[1] : rest[2]),
                    mathcolor: piece.color ?? defaultColor,
                  },
                  piece.text,
                ),
              ),
            );
        }
      }
      return node;
    };
    pushParser(parser);
  };
}
