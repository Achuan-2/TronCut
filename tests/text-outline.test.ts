import { expect, it } from "vitest";
import sharp from "sharp";
import { outlinedText } from "../electron/text-outline";

it("粗描边保持圆形轮廓、透明外角和抗锯齿边缘", async () => {
  const pixels = Buffer.alloc(17 * 17 * 4);
  pixels.fill(255, (8 * 17 + 8) * 4, (8 * 17 + 8) * 4 + 4);
  const glyph = await sharp(pixels, {
    raw: { width: 17, height: 17, channels: 4 },
  })
    .png()
    .toBuffer();
  const image = await outlinedText(glyph, "#ffffff", "#000000", 7, 10);
  const { data, info } = await sharp(image)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const alpha = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
  expect(info.width).toBe(37);
  expect(alpha(18, 18)).toBe(255);
  expect(alpha(24, 18)).toBeGreaterThan(240);
  expect(alpha(18, 24)).toBeGreaterThan(240);
  expect(alpha(24, 24)).toBeLessThan(5);
  expect(alpha(0, 0)).toBe(0);
  expect(
    Array.from(data).some(
      (value, index) => index % 4 === 3 && value > 5 && value < 250,
    ),
  ).toBe(true);
});

it("零描边保留原字形透明度，亚像素描边宽度不会向整像素跳变", async () => {
  const glyph = await sharp({
    text: { text: "思源笔记", font: "Microsoft YaHei Bold 42", rgba: true },
  })
    .png()
    .toBuffer();
  const plain = await outlinedText(glyph, "#ffffff", "#000000", 0, 5);
  const original = await sharp(glyph).extractChannel(3).raw().toBuffer();
  const preserved = await sharp(plain)
    .extract({
      left: 5,
      top: 5,
      width: (await sharp(glyph).metadata()).width!,
      height: (await sharp(glyph).metadata()).height!,
    })
    .extractChannel(3)
    .raw()
    .toBuffer();
  expect(preserved).toEqual(original);
  const alphaSum = async (radius: number) => {
    const mask = await sharp(
      await outlinedText(glyph, "#ffffff", "#000000", radius, 6),
    )
      .extractChannel(3)
      .raw()
      .toBuffer();
    return mask.reduce((total, value) => total + value, 0);
  };
  const narrow = await alphaSum(2);
  const middle = await alphaSum(2.5);
  const wide = await alphaSum(3);
  expect(middle).toBeGreaterThan(narrow);
  expect(middle).toBeLessThan(wide);
});
