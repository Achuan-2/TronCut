import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { Asset, Clip } from "../shared/model";
import { cursorAt, cursorSvg, defaultCursorStyle } from "../shared/cursor";
import { loopImageInput } from "./loop-image";

/** sendcmd keeps long mouse paths in a file, avoiding deeply nested FFmpeg expressions. */
export async function cursorFilters(
  asset: Asset,
  clip: Clip,
  fps: number,
  layer: number,
  workDir: string,
  input: number,
  signal: AbortSignal,
) {
  const style = clip.cursorStyle ?? defaultCursorStyle;
  if (!asset.cursor?.samples.length || style.style === "hidden") return null;
  const cursor = path.join(workDir, `cursor-${layer}.png`),
    ring = path.join(workDir, `click-${layer}.png`);
  await sharp(Buffer.from(cursorSvg(style)))
    .resize(Math.round(style.size), Math.round(style.size))
    .png()
    .toFile(cursor);
  const diameter = Math.round(style.size * 2);
  await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${diameter}" height="${diameter}"><circle cx="${diameter / 2}" cy="${diameter / 2}" r="${diameter / 2 - 3}" fill="none" stroke="${style.color}" stroke-width="3" opacity="0.65"/></svg>`,
    ),
  )
    .png()
    .toFile(ring);
  const filename = `cursor-${layer}.txt`,
    file = await fs.open(path.join(workDir, filename), "w");
  let last = "",
    buffer = "";
  try {
    for (let frame = 0; frame <= Math.ceil(clip.duration * fps); frame++) {
      if (signal.aborted) throw new Error("任务已取消");
      // Commands run after painting this frame, setting the position for the next one.
      // Putting sendcmd upstream lets framesync read ahead and applies the final position to every frame.
      const local = frame / fps,
        p = cursorAt(
          asset,
          clip,
          clip.sourceIn + (local + 1 / fps) * clip.speed,
        );
      const anchor =
        style.style === "arrow" ? style.size * 0.09 : style.size / 2;
      const x = p ? Math.round(p.x * asset.width - anchor) : -10000;
      const y = p
        ? Math.round(
            p.y * asset.height -
              (style.style === "arrow" ? style.size * 0.06 : style.size / 2),
          )
        : -10000;
      const ringX =
        p?.click && style.clicks
          ? Math.round((p.clickX ?? p.x) * asset.width - diameter / 2)
          : -10000;
      const ringY =
        p?.click && style.clicks
          ? Math.round((p.clickY ?? p.y) * asset.height - diameter / 2)
          : -10000;
      const command = `overlay@cursor${layer} x ${x},overlay@cursor${layer} y ${y},overlay@click${layer} x ${ringX},overlay@click${layer} y ${ringY}`;
      if (command !== last) {
        buffer += `${(clip.start + local).toFixed(6)} ${command};\n`;
        last = command;
      }
      if (buffer.length > 64000) {
        await file.write(buffer);
        buffer = "";
      }
    }
    if (buffer) await file.write(buffer);
  } finally {
    await file.close();
  }
  const first = cursorAt(asset, clip, clip.sourceIn);
  const firstX = first
    ? Math.round(
        first.x * asset.width -
          (style.style === "arrow" ? style.size * 0.09 : style.size / 2),
      )
    : -10000;
  const firstY = first
    ? Math.round(
        first.y * asset.height -
          (style.style === "arrow" ? style.size * 0.06 : style.size / 2),
      )
    : -10000;
  return {
    args: [
      ...loopImageInput(cursor, fps, clip.start + clip.duration),
      ...loopImageInput(ring, fps, clip.start + clip.duration),
    ],
    filters: [
      `null[cursorclock${layer}]`,
      `[cursorclock${layer}][${input + 1}:v]overlay@click${layer}=x=-10000:y=-10000:format=auto[clickvideo${layer}]`,
      `[clickvideo${layer}][${input}:v]overlay@cursor${layer}=x=${firstX}:y=${firstY}:format=auto,sendcmd=f=${filename}[cursorvideo${layer}]`,
    ],
    label: `cursorvideo${layer}`,
  };
}
