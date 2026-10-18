import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { Clip, TextStyle } from "../shared/model";
import {
  clipsBehaviorText,
  glyphMotion,
} from "../shared/behaviors";
import { rotationMatrix } from "../shared/rotation";
import { textFrameSize, textFillGeometry } from "../shared/text";
import { textFillRectangle } from "./text-fill";
import { outlinedText } from "./text-outline";
import { layoutStyledText } from "../shared/rich-text";

const xml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (value) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[value]!,
  );
/** Rasterize only changing glyph poses. Long stationary sections share one PNG
 * in the concat input rather than producing thousands of identical frames. */
export async function rasterizeBehaviorText(
  clip: Clip,
  workDir: string,
  layer: number,
  fps: number,
  still: boolean,
  signal: AbortSignal,
): Promise<{ width: number; height: number; input: string }> {
  const style = clip.style!,
    fontSize = style.fontSize;
  const directory = path.join(workDir, `behavior-${layer}`);
  await fs.mkdir(directory, { recursive: true });
  const checkCancelled = () => {
    if (signal.aborted) throw new Error("任务已取消");
  };
  const textBuffer = (text: string, glyphStyle: TextStyle, resolution = 1) =>
    sharp({
      text: {
        text: xml(text),
        font: `${glyphStyle.fontFamily} Bold ${glyphStyle.fontSize * resolution}`,
        rgba: true,
        dpi: 72,
      },
    })
      .png()
      .toBuffer();
  const widths = new Map<string, number>();
  const fontKey = (style: TextStyle) => JSON.stringify([style.fontFamily, style.fontSize]);
  const measureKey = (text: string, style: TextStyle) => JSON.stringify([text, fontKey(style)]);
  const sentinels = new Map<string, number>();
  const measure = async (text: string, style: TextStyle) => {
    const key = measureKey(text, style);
    if (widths.has(key)) return;
    checkCancelled();
    if (!sentinels.has(fontKey(style))) sentinels.set(fontKey(style), (await sharp(await textBuffer("|", style)).metadata()).width!);
    widths.set(
      key,
      Math.max(
        0,
        (await sharp(await textBuffer(text + "|", style)).metadata()).width! -
          sentinels.get(fontKey(style))!,
      ),
    );
  };
  const measurements = new Map<string, { text: string; style: TextStyle }>();
  layoutStyledText(clip, (text, style) => { measurements.set(measureKey(text, style), { text, style }); return 0; });
  for (const { text, style } of measurements.values()) await measure(text, style);
  const layout = layoutStyledText(clip, (text, style) => widths.get(measureKey(text, style)) ?? 0);
  const glyphKey = (glyph: (typeof layout.glyphs)[number]) => JSON.stringify([glyph.text, glyph.style]);
  const images = new Map<
    string,
    { width: number; height: number; data: string }
  >();
  // Perspective fly-in enlarges letters dramatically. Supersample its cached
  // glyph textures instead of magnifying a low-resolution mask in every frame.
  const resolution = clip.behaviors?.some(
    (behavior) =>
      behavior.enabled &&
      [behavior.incoming, behavior.during, behavior.outgoing].some(
        (phase) => phase.style === "fly",
      ),
  )
    ? 4
    : 1;
  for (const glyph of layout.glyphs) {
    if (images.has(glyphKey(glyph)) || !glyph.text.trim()) continue;
    checkCancelled();
    const mask = await textBuffer(glyph.text, glyph.style, resolution),
      info = await sharp(mask).metadata();
    const margin = Math.ceil(glyph.style.outlineWidth * resolution) + 2;
    const width = info.width! + margin * 2,
      height = info.height! + margin * 2;
    const png = await outlinedText(
      mask,
      glyph.style.color,
      glyph.style.outline,
      glyph.style.outlineWidth * resolution,
      margin,
    );
    images.set(glyphKey(glyph), {
      width: width / resolution,
      height: height / resolution,
      data: png.toString("base64"),
    });
  }
  const maxFont = Math.max(fontSize, ...layout.glyphs.map((glyph) => glyph.style.fontSize));
  const maxOutline = Math.max(style.outlineWidth, ...layout.glyphs.map((glyph) => glyph.style.outlineWidth));
  const padding = Math.ceil(maxFont * (clip.behaviors?.some((behavior) => behavior.enabled) ? 6 : 0) + maxOutline * 2 + 12);
  const box = clip.textRuns?.length && !clip.textBox ? { width: layout.width + maxOutline * 2, height: layout.height + maxOutline * 2 } : textFrameSize(clip, layout.width);
  const background = textFillGeometry(style, box);
  const width = Math.ceil(
      Math.max(layout.width, background.width) + padding * 2,
    ),
    height = Math.ceil(
      Math.max(layout.height, background.height) + padding * 2,
    );
  const left = (width - layout.width) / 2,
    top = (height - layout.height) / 2;
  const fill = textFillRectangle(clip, box, { width, height });
  const cache = new Map<string, string>(),
    runs: { file: string; frames: number }[] = [];
  const count = still ? 1 : Math.max(1, Math.ceil(clip.duration * fps));
  for (let frame = 0; frame < count; frame++) {
    checkCancelled();
    const motions = layout.glyphs.map((glyph) =>
      glyphMotion(clip, frame / fps, glyph.index, layout.count, "text"),
    );
    const clipped = clipsBehaviorText(clip, frame / fps, layout.count);
    const signature = JSON.stringify([clipped, motions]);
    let file = cache.get(signature);
    if (!file) {
      file = `${cache.size}.png`;
      const body = layout.glyphs
        .map((glyph, index) => {
          const image = images.get(glyphKey(glyph)),
            motion = motions[index];
          if (!image || motion.opacity <= 0) return "";
          const { a, b, c, d } = rotationMatrix(motion);
          return `<g opacity="${motion.opacity}" transform="translate(${left + glyph.x + motion.x * fontSize} ${top + glyph.y + motion.y * fontSize}) matrix(${a} ${b} ${c} ${d} 0 0) scale(${motion.scale})"><image x="${-image.width / 2}" y="${-image.height / 2}" width="${image.width}" height="${image.height}" href="data:image/png;base64,${image.data}"/></g>`;
        })
        .join("");
      await sharp(
        Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${fill}${
            clipped
              ? `<defs><clipPath id="frame"><rect x="${(width - box.width) / 2}" y="${(height - box.height) / 2}" width="${box.width}" height="${box.height}"/></clipPath></defs><g clip-path="url(#frame)">${body}</g>`
              : body
          }</svg>`,
        ),
      )
        .png()
        .toFile(path.join(directory, file));
      cache.set(signature, file);
    }
    const previous = runs.at(-1);
    if (previous?.file === file) previous.frames++;
    else runs.push({ file, frames: 1 });
  }
  const input = path.join(directory, "frames.ffconcat");
  await fs.writeFile(
    input,
    `ffconcat version 1.0\n${runs.map((run) => `file '${run.file}'\noption framerate ${fps}\nduration ${run.frames / fps}`).join("\n")}\nfile '${runs.at(-1)!.file}'\noption framerate ${fps}\n`,
  );
  return { width, height, input };
}
