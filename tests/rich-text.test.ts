import { describe, expect, it } from "vitest";
import { createProject, newText, validateProject } from "../shared/model";
import {
  applyCharacterStyle,
  characterStyleAt,
  layoutStyledText,
  reconcileTextRuns,
} from "../shared/rich-text";

describe("局部文字样式", () => {
  it("加粗、斜体和下划线保留局部关闭覆盖，不合并格式不同的相邻范围", () => {
    const original = newText("titles", 0, 0, "甲乙丙丁");
    original.style = {
      ...original.style!,
      bold: true,
      italic: true,
      underline: true,
    };
    const first = applyCharacterStyle(
      original,
      { start: 0, end: 1 },
      { bold: false, underline: false },
    );
    const second = applyCharacterStyle(
      first,
      { start: 1, end: 2 },
      { bold: false, italic: false },
    );
    expect(second.textRuns).toHaveLength(2);
    expect(characterStyleAt(second, 0)).toMatchObject({
      bold: false,
      italic: true,
      underline: false,
    });
    expect(characterStyleAt(second, 1)).toMatchObject({
      bold: false,
      italic: false,
      underline: true,
    });
    expect(characterStyleAt(second, 2)).toMatchObject({
      bold: true,
      italic: true,
      underline: true,
    });
    expect(
      validateProject({ ...createProject(), clips: [second] }).clips[0],
    ).toEqual(second);
    const whole = applyCharacterStyle(second, null, {
      bold: false,
      underline: false,
    });
    expect(whole.textRuns).toEqual([
      { start: 1, end: 2, style: { italic: false } },
    ]);
    expect(characterStyleAt(whole, 2)).toMatchObject({
      bold: false,
      italic: true,
      underline: false,
    });
  });
  it("交叠选区保留其他属性，整段修改只覆盖指定属性", () => {
    const original = newText("titles", 0, 0, "甲乙丙丁");
    const red = applyCharacterStyle(
      original,
      { start: 1, end: 3 },
      { color: "#ff0000" },
    );
    const sized = applyCharacterStyle(
      red,
      { start: 2, end: 4 },
      { fontSize: 100, fontFamily: "Arial" },
    );
    expect(characterStyleAt(sized, 0)).toEqual(original.style);
    expect(characterStyleAt(sized, 1)).toMatchObject({
      color: "#ff0000",
      fontSize: original.style!.fontSize,
    });
    expect(characterStyleAt(sized, 2)).toMatchObject({
      color: "#ff0000",
      fontSize: 100,
      fontFamily: "Arial",
    });
    expect(characterStyleAt(sized, 3)).toMatchObject({
      color: original.style!.color,
      fontSize: 100,
    });
    const whole = applyCharacterStyle(sized, null, { color: "#00ff00" });
    expect(whole.textRuns).toEqual([
      { start: 2, end: 4, style: { fontSize: 100, fontFamily: "Arial" } },
    ]);
    expect(characterStyleAt(whole, 2)).toMatchObject({
      color: "#00ff00",
      fontSize: 100,
    });
    expect(original.textRuns).toBeUndefined();
    expect(
      validateProject({ ...createProject(), clips: [whole] }).clips[0],
    ).toEqual(whole);
  });
  it("中文、emoji、多行插入替换删除后，后面的样式继续跟随原文", () => {
    const original = applyCharacterStyle(
      newText("titles", 0, 0, "甲😀乙\n丙丁"),
      { start: 4, end: 7 },
      { color: "#ff0000" },
    );
    const inserted = reconcileTextRuns(original, {
      ...original,
      text: "新甲😀乙\n丙丁",
    });
    expect(inserted.textRuns).toEqual([
      { start: 5, end: 8, style: { color: "#ff0000" } },
    ]);
    const replaced = reconcileTextRuns(inserted, {
      ...inserted,
      text: "新甲😀乙\n替换丁",
    });
    expect(replaced.textRuns).toEqual([
      { start: 5, end: 9, style: { color: "#ff0000" } },
    ]);
    expect(
      reconcileTextRuns(replaced, { ...replaced, text: "" }).textRuns,
    ).toBeUndefined();
  });
  it("混合字号和字体按行居中，emoji按一个字形布局", () => {
    const original = newText("titles", 0, 0, "甲😀\n乙");
    original.style = { ...original.style!, fontSize: 20 };
    const clip = applyCharacterStyle(
      original,
      { start: 1, end: 3 },
      { fontSize: 40 },
    );
    const layout = layoutStyledText(
      clip,
      (text, style) => Array.from(text).length * style.fontSize,
    );
    expect(layout.count).toBe(3);
    expect(layout.width).toBe(60);
    expect(layout.height).toBe(75);
    expect(
      layout.glyphs.map((glyph) => [
        glyph.text,
        glyph.x,
        glyph.y,
        glyph.style.fontSize,
      ]),
    ).toEqual([
      ["甲", 10, 25, 20],
      ["😀", 40, 25, 40],
      ["乙", 30, 62.5, 20],
    ]);
  });
});
