import { describe, expect, it } from "vitest";
import {
  createProject,
  defaultTransform,
  newText,
  textPresets,
  validateProject,
} from "../shared/model";
import {
  fitTextFont,
  resizeTextBox,
  textFill,
  textFillCss,
  textFillGeometry,
} from "../shared/text";

describe("文本框与自动字号", () => {
  it("填充默认留白和圆角独立于文字框，并限制圆角不超过背景尺寸", () => {
    const clip = newText("titles", 0);
    const frame = { width: 100, height: 40 };
    expect(textFillGeometry(clip.style, frame)).toEqual({
      paddingX: 12,
      paddingY: 6,
      width: 124,
      height: 52,
      radius: 6,
    });
    expect(
      textFillGeometry(
        { ...clip.style!, fillPaddingX: 20, fillPaddingY: 8, fillRadius: 200 },
        frame,
      ),
    ).toEqual({
      paddingX: 20,
      paddingY: 8,
      width: 140,
      height: 56,
      radius: 28,
    });
    expect(frame).toEqual({ width: 100, height: 40 });
    expect(() =>
      validateProject({
        ...createProject(),
        clips: [{ ...clip, style: { ...clip.style!, fillPaddingX: -1 } }],
      }),
    ).toThrow();
  });

  it("新增文本的所有预设默认无背景，旧工程和主动开启的填充仍保留", () => {
    for (const [index] of textPresets.entries()) {
      const preset = newText("titles", 0, index);
      expect(preset.style!.fillEnabled).toBe(false);
      expect(textFill(preset.style).opacity).toBe(0);
      const reopened = validateProject({ ...createProject(), clips: [preset] });
      expect(textFill(reopened.clips[0].style).opacity).toBe(0);
    }
    const clip = newText("titles", 0);
    expect(textFill(clip.style)).toEqual({ color: "#000000", opacity: 0 });
    expect(textFillCss(clip.style)).toBe("#00000000");
    const legacy = { ...clip.style! };
    delete legacy.fillEnabled;
    delete legacy.fill;
    delete legacy.fillOpacity;
    expect(textFill(legacy)).toEqual({ color: "#000000", opacity: 0.75 });
    expect(textFillCss(legacy)).toBe("#000000bf");
    expect(
      textFill({ ...clip.style!, fill: "#ff0000", fillOpacity: 0 }),
    ).toEqual({ color: "#ff0000", opacity: 0 });
    const disabled = {
      ...clip.style!,
      fill: "#123456",
      fillOpacity: 0.5,
      fillEnabled: false,
    };
    expect(textFill(disabled)).toEqual({ color: "#123456", opacity: 0 });
    expect(textFillCss(disabled)).toBe("#12345600");
    const reopened = validateProject({
      ...createProject(),
      clips: [{ ...clip, style: disabled }],
    });
    expect(reopened.clips[0].style).toMatchObject(disabled);
    expect(
      textFill({ ...reopened.clips[0].style!, fillEnabled: true }),
    ).toEqual({ color: "#123456", opacity: 0.5 });
    expect(() =>
      validateProject({
        ...createProject(),
        clips: [{ ...clip, style: { ...clip.style!, fillOpacity: 1.1 } }],
      }),
    ).toThrow();
  });

  const canvas = { width: 1000, height: 500 };
  it("独立拉宽文本框，保持字号所用的图层缩放和左边缘", () => {
    const resized = resizeTextBox(
      defaultTransform,
      { width: 200, height: 100 },
      { x: 100, y: 40 },
      { x: 1, y: 0 },
      canvas,
    );
    expect(resized.box).toEqual({ width: 300, height: 100 });
    expect(resized.value.scale).toBe(1);
    expect(resized.value.x * canvas.width - resized.box.width / 2).toBe(400);
    expect(resized.value.y).toBe(0.5);
  });
  it("处理图层旋转、缩放和跨过对侧的尺寸限制", () => {
    const result = resizeTextBox(
      { ...defaultTransform, scale: 2 },
      { width: 200, height: 100 },
      { x: 0, y: 200 },
      { x: 1, y: 0 },
      canvas,
      90,
    );
    expect(result.box).toEqual({ width: 300, height: 100 });
    expect(result.value.x).toBeCloseTo(0.5);
    expect(result.value.y * canvas.height - result.box.width).toBeCloseTo(50);
    const small = resizeTextBox(
      defaultTransform,
      result.box,
      { x: -10000, y: -10000 },
      { x: 1, y: 1 },
      canvas,
    );
    expect(small.box).toEqual({ width: 16, height: 16 });
  });
  it("字号取宽高共同容纳的最大值，支持多行和描边，并限制合法字号", () => {
    const measure = (line: string) => line.length * 100;
    expect(fitTextFont("中文", { width: 204, height: 200 }, 2, measure)).toBe(
      100,
    );
    expect(
      fitTextFont("第一行\n第二行", { width: 600, height: 104 }, 2, measure),
    ).toBe(40);
    expect(fitTextFont("大", { width: 30000, height: 30000 }, 0, measure)).toBe(
      300,
    );
    expect(fitTextFont("小", { width: 16, height: 16 }, 20, measure)).toBe(8);
  });
  it("旧工程仍可打开，新增文本框及自动设置往返后保留", () => {
    const project = createProject();
    const text = newText("titles", 0);
    project.clips = [text];
    expect(validateProject(project).clips[0].autoResizeText).toBeUndefined();
    text.textBox = { width: 320, height: 160 };
    text.autoResizeText = true;
    const parsed = validateProject(JSON.parse(JSON.stringify(project)));
    expect(parsed.clips[0].textBox).toEqual(text.textBox);
    expect(parsed.clips[0].autoResizeText).toBe(true);
    expect(() =>
      validateProject({
        ...project,
        clips: [{ ...text, textBox: { width: 0, height: 100 } }],
      }),
    ).toThrow();
  });
});
