import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { Asset, Clip } from "../shared/model";
import {
  cursorAt,
  cursorSvg,
  cursorAnchor,
  cursorAspect,
  defaultCursorStyle,
  type CursorShape,
} from "../shared/cursor";
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
  still = false,
  format: "auto" | "yuv444" = "auto",
) {
  const style = clip.cursorStyle ?? defaultCursorStyle;
  if (!asset.cursor?.samples.length || style.style === "hidden") return null;
  const shapes: CursorShape[] = [
    ...new Set(
      asset.cursor.samples.map((sample) => sample.cursorType ?? "arrow"),
    ),
  ];
  const atlas = shapes.length > 1;
  const cell = Math.ceil(style.size * 4);
  const firstShape =
    cursorAt(asset, clip, clip.sourceIn)?.cursorType ?? "arrow";
  const hotspot = atlas
    ? { x: 0.5, y: 0.5 }
    : cursorAnchor(style.style, shapes[0]);
  const cursorWidth = atlas
    ? cell
    : Math.round(style.size * cursorAspect(style.style, shapes[0]));
  const cursorHeight = atlas ? cell : Math.round(style.size);
  const cursor = path.join(workDir, `cursor-${layer}.png`),
    ring = path.join(workDir, `click-${layer}.png`);
  if (atlas) {
    const images = await Promise.all(
      shapes.map(async (shape, index) => {
        const width = Math.round(style.size * cursorAspect(style.style, shape));
        const anchor = cursorAnchor(style.style, shape);
        return {
          input: await sharp(Buffer.from(cursorSvg(style, shape)))
            .resize(width, Math.round(style.size), { fit: "fill" })
            .png()
            .toBuffer(),
          left: index * cell + Math.round(cell / 2 - width * anchor.x),
          top: Math.round(cell / 2 - style.size * anchor.y),
        };
      }),
    );
    await sharp({
      create: {
        width: cell * shapes.length,
        height: cell,
        channels: 4,
        background: "#00000000",
      },
    })
      .composite(images)
      .png()
      .toFile(cursor);
  } else {
    await sharp(Buffer.from(cursorSvg(style, shapes[0])))
      .resize(cursorWidth, cursorHeight, { fit: "fill" })
      .png()
      .toFile(cursor);
  }
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
    for (
      let frame = 0;
      !still && frame <= Math.ceil(clip.duration * fps);
      frame++
    ) {
      if (signal.aborted) throw new Error("任务已取消");
      // Commands run after painting this frame, setting the position for the next one.
      // Putting sendcmd upstream lets framesync read ahead and applies the final position to every frame.
      const local = frame / fps,
        p = cursorAt(
          asset,
          clip,
          clip.sourceIn + (local + 1 / fps) * clip.speed,
        );
      const anchor = cursorWidth * hotspot.x;
      const x = p ? Math.round(p.x * asset.width - anchor) : -10000;
      const y = p
        ? Math.round(p.y * asset.height - cursorHeight * hotspot.y)
        : -10000;
      const ringX =
        p?.click && style.clicks
          ? Math.round((p.clickX ?? p.x) * asset.width - diameter / 2)
          : -10000;
      const ringY =
        p?.click && style.clicks
          ? Math.round((p.clickY ?? p.y) * asset.height - diameter / 2)
          : -10000;
      const shapeIndex = Math.max(0, shapes.indexOf(p?.cursorType ?? "arrow"));
      const command = `overlay@cursor${layer} x ${x},overlay@cursor${layer} y ${y},overlay@click${layer} x ${ringX},overlay@click${layer} y ${ringY}${atlas ? `,crop@cursorArt${layer} x ${shapeIndex * cell}` : ""}`;
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
    ? Math.round(first.x * asset.width - cursorWidth * hotspot.x)
    : -10000;
  const firstY = first
    ? Math.round(first.y * asset.height - cursorHeight * hotspot.y)
    : -10000;
  const ringX =
    still && first?.click && style.clicks
      ? Math.round((first.clickX ?? first.x) * asset.width - diameter / 2)
      : -10000;
  const ringY =
    still && first?.click && style.clicks
      ? Math.round((first.clickY ?? first.y) * asset.height - diameter / 2)
      : -10000;
  return {
    args: [
      ...loopImageInput(cursor, fps, clip.start + clip.duration),
      ...loopImageInput(ring, fps, clip.start + clip.duration),
    ],
    filters: [
      `null[cursorclock${layer}]`,
      ...(atlas
        ? [
            `[${input}:v]crop@cursorArt${layer}=w=${cell}:h=${cell}:x=${Math.max(0, shapes.indexOf(firstShape)) * cell}:y=0[cursorart${layer}]`,
          ]
        : []),
      `[cursorclock${layer}][${input + 1}:v]overlay@click${layer}=x=${ringX}:y=${ringY}:format=${format}[clickvideo${layer}]`,
      `[clickvideo${layer}][${atlas ? `cursorart${layer}` : `${input}:v`}]overlay@cursor${layer}=x=${firstX}:y=${firstY}:format=${format}${still ? "" : `,sendcmd=f=${filename}`}[cursorvideo${layer}]`,
    ],
    label: `cursorvideo${layer}`,
  };
}
