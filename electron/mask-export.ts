import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { Clip } from "../shared/model";
import { createTransformSampler } from "../shared/editor";
import { maskClipAt } from "../shared/mask-state";
import { regionSvg } from "../shared/visual-effect-svg";

/** Cache held states instead of writing a PNG for every stationary frame. */
export async function rasterizeMaskAnimation(options: {
  clip: Clip;
  layer: number;
  workDir: string;
  width: number;
  height: number;
  fit: number;
  fps: number;
  duration: number;
  signal?: AbortSignal;
}) {
  const { clip, layer, workDir, width, height, fit, fps, duration, signal } =
    options;
  const directory = path.join(workDir, `mask-${layer}`);
  await fs.mkdir(directory, { recursive: true });
  const sample = createTransformSampler(clip);
  const cache = new Map<string, string>();
  const runs: { file: string; frames: number }[] = [];
  const count = Math.max(1, Math.ceil(duration * fps));
  for (let frame = 0; frame < count; frame++) {
    if (signal?.aborted) throw new Error("任务已取消");
    const local = Math.max(
      0,
      Math.min(clip.duration, frame / fps - clip.start),
    );
    const region = maskClipAt(clip, sample(local)).visualEffects!.mask!;
    const signature = JSON.stringify([
      region.x,
      region.y,
      region.width,
      region.height,
      region.rotation,
      region.radius,
      region.feather,
      region.shape,
      region.invert,
      region.opacity,
    ]);
    let file = cache.get(signature);
    if (!file) {
      file = `${cache.size}.png`;
      await sharp(Buffer.from(regionSvg(region, width, height, 1 / fit)))
        .removeAlpha()
        .linear(1 - region.opacity, region.opacity * 255)
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
  return input;
}
