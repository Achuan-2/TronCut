import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { newText } from "../shared/model";
import {
  hasMathText,
  mathTextTokens,
  renderFormula,
} from "../shared/math-text";
import { applyCharacterStyle, layoutStyledText } from "../shared/rich-text";
import { behaviorGlyphCount } from "../shared/behaviors";

const style = {
  ...newText("titles", 0).style!,
  fontSize: 48,
  outlineWidth: 0,
  color: "#00ff00",
};
const measure = (text: string) => Array.from(text).length * 24;

describe("Markdown 公式文字", () => {
  it("识别行内、连续公式和跨行独立公式，保留 UTF-16 源码位置", () => {
    const text = "😀 $x^2$$y$\n$$\n\\frac{a}{b}\n$$";
    const formulas = mathTextTokens(text).filter(
      (token) => token.tex !== undefined,
    );
    expect(formulas.map((token) => [token.tex, token.display])).toEqual([
      ["x^2", false],
      ["y", false],
      ["\\frac{a}{b}", true],
    ]);
    expect(formulas[0].start).toBe(3);
    expect(formulas[0].contentStart).toBe(4);
    expect(text.slice(formulas[0].start, formulas[0].end)).toBe("$x^2$");
    for (const text of [
      "价格 $5 和 $10",
      String.raw`价格 \$5，\$10`,
      "$x",
      "$$",
      "$ x $",
      "$x\ny$",
    ])
      expect(hasMathText(text)).toBe(false);
  });

  it("生成无外部字体的路径，颜色、字号和描边可独立修改", async () => {
    const formula = renderFormula(
      String.raw`\frac{a_1}{b^2}+\sqrt{x}`,
      true,
      style,
    )!;
    expect(formula.svg).toContain("<path");
    expect(formula.svg).not.toContain("<use");
    expect(formula.svg).not.toContain("currentColor");
    const large = renderFormula(String.raw`\frac{a_1}{b^2}+\sqrt{x}`, true, {
      ...style,
      fontSize: 96,
    })!;
    expect(large.width).toBeCloseTo(formula.width * 2);
    const { data } = await sharp(Buffer.from(formula.svg))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let green = 0;
    for (let i = 0; i < data.length; i += 4)
      if (
        data[i] < 30 &&
        data[i + 1] > 180 &&
        data[i + 2] < 30 &&
        data[i + 3] > 150
      )
        green++;
    expect(green).toBeGreaterThan(100);
    const outlined = renderFormula("x^2", false, {
      ...style,
      outlineWidth: 2,
      outline: "#ff0000",
    })!;
    expect(outlined.svg).toContain('stroke="#ff0000"');
    await expect(
      sharp(Buffer.from(outlined.svg)).png().toBuffer(),
    ).resolves.toBeInstanceOf(Buffer);
  });

  it("支持公式内部着色，错误语法回退源码且不会污染其他公式", () => {
    const colored = renderFormula(
      String.raw`\textcolor{red}{x}+y`,
      false,
      style,
    )!;
    expect(colored.svg).toContain('fill="red"');
    expect(colored.svg).toContain('fill="#00ff00"');
    expect(renderFormula(String.raw`\frac{a}{`, false, style)).toBeNull();
    expect(renderFormula(String.raw`\unknowncommand`, false, style)).toBeNull();
    expect(
      renderFormula(String.raw`\newcommand{\mine}{x}\mine`, false, style),
    ).not.toBeNull();
    expect(renderFormula(String.raw`\mine+1`, false, style)).toBeNull();
    const clip = { ...newText("titles", 0, 0, String.raw`$\frac{a}{$`), style };
    expect(
      layoutStyledText(clip, measure)
        .glyphs.map((glyph) => glyph.text)
        .join(""),
    ).toBe(clip.text);
  });

  it("混排与独立公式按实际尺寸排版，选中公式源码可以单独改颜色", () => {
    const text = "甲 $x^2$\n$$\\frac{a}{b}$$\n乙";
    const clip = { ...newText("titles", 0, 0, text), style };
    const colored = applyCharacterStyle(
      clip,
      { start: 3, end: 6 },
      { color: "#ff0000" },
    );
    const layout = layoutStyledText(colored, measure);
    const formulas = layout.glyphs.filter((glyph) => glyph.formula);
    expect(formulas).toHaveLength(2);
    expect(formulas[0].style.color).toBe("#ff0000");
    expect(formulas[1].style.color).toBe("#00ff00");
    expect(formulas[1].y).toBeGreaterThan(formulas[0].y);
    expect(layout.glyphs.at(-1)!.y).toBeGreaterThan(formulas[1].y);
    expect(
      layout.glyphs.some((glyph) => glyph.text === "$" || glyph.text === "\\"),
    ).toBe(false);
    expect(formulas[1].x).toBeCloseTo(layout.width / 2);
    expect(behaviorGlyphCount(colored)).toBe(layout.count);
  });

  it.each([
    ["$x+y$", "x"],
    ["$x+y$", "y"],
    [String.raw`$\frac{x}{x+y}$`, "y"],
    [String.raw`$\frac xy+z$`, "y"],
    [String.raw`$\sqrt[3]{x}+y$`, "3"],
    [String.raw`$\sqrt[3]{x}+y$`, "x"],
    ["$x^2+y_1$", "1"],
    [String.raw`$\alpha+\beta$`, String.raw`\beta`],
    [String.raw`$\alpha+\beta$`, "beta"],
    ["$12345+x$", "34"],
    [String.raw`$\text{hello}+x$`, "ell"],
    [String.raw`$\newcommand{\mine}{x}\mine+y$`, "y"],
    [String.raw`$\newcommand{\mine}{x}\mine+y$`, String.raw`\mine`],
    [String.raw`$\frac{x}{y}+z$`, String.raw`\frac{x}`],
    [String.raw`$\textcolor{blue}{x+y}+z$`, "y"],
  ])("源码选区局部着色且保留其他符号颜色：%s / %s", async (text, selected) => {
    const clip = { ...newText("titles", 0, 0, text), style };
    const start = text.lastIndexOf(selected);
    const colored = applyCharacterStyle(
      clip,
      { start, end: start + selected.length },
      { color: "#ff0000" },
    );
    const layout = layoutStyledText(colored, measure);
    const formula = layout.glyphs[0].formula;
    expect(formula).toBeDefined();
    const { data } = await sharp(Buffer.from(formula!.svg))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let red = 0,
      green = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 150) continue;
      if (data[i] > 180 && data[i + 1] < 30 && data[i + 2] < 30) red++;
      if (data[i + 1] > 180 && data[i] < 30 && data[i + 2] < 30) green++;
    }
    expect(red).toBeGreaterThan(10);
    expect(green).toBeGreaterThan(10);
    expect(colored.text).toBe(text);
    expect(behaviorGlyphCount(colored)).toBe(layout.count);
    // A differently colored conversion must not reuse a stale cached shape.
    expect(
      layoutStyledText(clip, measure).glyphs[0].formula!.svg,
    ).not.toContain('fill="#ff0000"');
  });
});
