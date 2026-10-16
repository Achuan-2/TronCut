import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { Clip } from "../shared/model";
import {
  annotationSvgBody,
  drawingProgress,
  shapeSize,
} from "../shared/annotation-style";

export async function rasterizeAnnotation(clip: Clip, file: string, time = 0) {
  const size = shapeSize(clip);
  const width = Math.max(1, Math.ceil(size.width)),
    height = Math.max(1, Math.ceil(size.height));
  await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${size.width} ${size.height}">${annotationSvgBody(clip, drawingProgress(clip, time))}</svg>`,
    ),
  )
    .png()
    .toFile(file);
  return { width, height };
}

/** Cache equal progress frames, including the static tail after drawing ends. */
export async function rasterizeDrawing(
  clip: Clip,
  directory: string,
  fps: number,
  signal: AbortSignal,
) {
  await fs.mkdir(directory, { recursive: true });
  const count = Math.max(1, Math.ceil(clip.duration * fps));
  const first = Math.max(
    0,
    Math.ceil(((clip.drawing?.delay ?? 0) - (clip.animationOffset ?? 0)) * fps),
  );
  const last = Math.min(
    count,
    Math.ceil(
      ((clip.drawing?.delay ?? 0) +
        (clip.drawing?.duration ?? 0) -
        (clip.animationOffset ?? 0)) *
        fps,
    ) + 1,
  );
  const runs: { file: string; frames: number }[] = [];
  let size = shapeSize(clip);
  for (let frame = 0; frame < count;) {
    if (signal.aborted) throw new Error("任务已取消");
    const end =
      frame < first
        ? Math.min(count, first)
        : frame >= last
          ? count
          : frame + 1;
    const file = `${frame}.png`;
    size = await rasterizeAnnotation(
      clip,
      path.join(directory, file),
      frame / fps,
    );
    runs.push({ file, frames: end - frame });
    frame = end;
  }
  const input = path.join(directory, "frames.ffconcat");
  await fs.writeFile(
    input,
    `ffconcat version 1.0\n${runs.map((run) => `file '${run.file}'\noption framerate ${fps}\nduration ${run.frames / fps}`).join("\n")}\nfile '${runs.at(-1)!.file}'\noption framerate ${fps}\n`,
  );
  return { ...size, input };
}

/** The transformed white annotation is a mask for the already-composed scene. */
export function regionAnnotationFilters(
  clip: Clip,
  base: string,
  visual: string,
  output: string,
  width: number,
  height: number,
  fps: number,
  duration: number,
  x: string,
  y: string,
  opacity: string,
) {
  const effect = clip.annotationEffect!;
  const prefix = `${output}region`;
  const mask = `${prefix}mask`,
    frame = `${prefix}frame`,
    full = `${prefix}full`;
  const start = clip.start,
    end = clip.start + clip.duration;
  const active = `gte(t,${start})*lt(t,${end})`;
  const filters = [
    `color=c=black:s=${width}x${height}:r=${fps}:d=${duration},format=gbrp[${frame}]`,
    `[${frame}][${visual}]overlay=x='${x}':y='${y}':enable='${active}':eof_action=pass:repeatlast=0:format=auto[${full}]`,
    `[${full}]format=gray${effect.type === "spotlight" ? `,negate=enable='${active}',geq=lum='lum(X,Y)*(${opacity})'` : ""}[${mask}]`,
    `[${base}]split=2[${prefix}original][${prefix}source]`,
  ];
  let process: string;
  if (effect.type === "blur") process = `gblur=sigma=${effect.amount}`;
  else if (effect.type === "pixelate")
    process = `scale=${Math.max(1, Math.round(width / effect.amount))}:${Math.max(1, Math.round(height / effect.amount))}:flags=neighbor,scale=${width}:${height}:flags=neighbor`;
  else if (effect.type === "highlight")
    process = `drawbox=x=0:y=0:w=iw:h=ih:color=${effect.color}@${effect.opacity}:t=fill`;
  else
    process = `colorchannelmixer=rr=${1 - effect.opacity}:gg=${1 - effect.opacity}:bb=${1 - effect.opacity}`;
  filters.push(`[${prefix}source]${process},format=gbrp[${prefix}processed]`);
  filters.push(`[${prefix}original]format=gbrp[${prefix}normal]`);
  filters.push(
    `[${prefix}normal][${prefix}processed][${mask}]maskedmerge[${output}]`,
  );
  return filters;
}
