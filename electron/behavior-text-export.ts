import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { Clip } from "../shared/model";
import { glyphMotion, layoutGlyphs, textGlyphs } from "../shared/behaviors";
import { textFrameSize, textFillGeometry } from "../shared/text";
import { textFillRectangle } from "./text-fill";
import { outlinedText } from "./text-outline";

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
  const textBuffer = (text: string) =>
    sharp({
      text: {
        text: xml(text),
        font: `${style.fontFamily} Bold ${fontSize}`,
        rgba: true,
        dpi: 72,
      },
    })
      .png()
      .toBuffer();
  const widths = new Map<string, number>();
  const sentinel = (await sharp(await textBuffer("|")).metadata()).width!;
  const measure = async (text: string) => {
    if (widths.has(text)) return;
    checkCancelled();
    widths.set(
      text,
      Math.max(
        0,
        (await sharp(await textBuffer(text + "|")).metadata()).width! -
          sentinel,
      ),
    );
  };
  await measure("");
  for (const line of (clip.text ?? "").split("\n")) {
    await measure(line);
    let prefix = "";
    for (const glyph of textGlyphs(line)) {
      await measure(prefix);
      await measure(glyph);
      prefix += glyph;
    }
  }
  const layout = layoutGlyphs(
    clip.text ?? "",
    fontSize,
    (text) => widths.get(text) ?? 0,
  );
  const images = new Map<
    string,
    { width: number; height: number; data: string }
  >();
  for (const glyph of layout.glyphs) {
    if (images.has(glyph.text) || !glyph.text.trim()) continue;
    checkCancelled();
    const mask = await textBuffer(glyph.text),
      info = await sharp(mask).metadata();
    const margin = Math.ceil(style.outlineWidth) + 2;
    const width = info.width! + margin * 2,
      height = info.height! + margin * 2;
    const png = await outlinedText(
      mask,
      style.color,
      style.outline,
      style.outlineWidth,
      margin,
    );
    images.set(glyph.text, { width, height, data: png.toString("base64") });
  }
  const padding = Math.ceil(fontSize * 6 + style.outlineWidth * 2 + 12);
  const box = textFrameSize(clip, layout.width);
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
    const signature = JSON.stringify(motions);
    let file = cache.get(signature);
    if (!file) {
      file = `${cache.size}.png`;
      const body = layout.glyphs
        .map((glyph, index) => {
          const image = images.get(glyph.text),
            motion = motions[index];
          if (!image || motion.opacity <= 0) return "";
          return `<g opacity="${motion.opacity}" transform="translate(${left + glyph.x + motion.x * fontSize} ${top + glyph.y + motion.y * fontSize}) rotate(${motion.rotation}) scale(${motion.scale})"><image x="${-image.width / 2}" y="${-image.height / 2}" width="${image.width}" height="${image.height}" href="data:image/png;base64,${image.data}"/></g>`;
        })
        .join("");
      await sharp(
        Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${fill}${body}</svg>`,
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
