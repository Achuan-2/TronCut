import path from "node:path";
import sharp from "sharp";
import type { Clip } from "../shared/model";
import { rgb, type EffectTiming } from "../shared/visual-effects";
import { regionSvg, visualEffectPadding } from "../shared/visual-effect-svg";
import { loopImageInput } from "./loop-image";
import { hasMaskAnimation, maskClipAt } from "../shared/mask-state";
import { transformAt } from "../shared/editor";
import { rasterizeMaskAnimation } from "./mask-export";
import { effectActiveExpression, originalEffectWindow } from "../shared/effect-timing";
import { mediaFrameRadii, supportsMediaFrame } from "../shared/media-frame";

/** Frame geometry stays independent of holes in the source alpha channel. */
function borderFrameAlpha(
  clip: Clip,
  width: number,
  height: number,
  fit: number,
  padding: number,
) {
  const rectangle = `between(X,${padding},${padding + width - 1})*between(Y,${padding},${padding + height - 1})`;
  const frame = clip.mediaFrame;
  if (
    !supportsMediaFrame(clip) || !frame || frame.enabled === false || !frame.radius
  )
    return `255*${rectangle}`;
  // The window is evaluated per output frame, including split-clip offsets.
  const radii = mediaFrameRadii(
    { ...clip, mediaFrame: { ...frame, window: undefined } },
    { width: width * fit, height: height * fit },
  ).map((radius) => Math.min(radius / fit, width / 2, height / 2));
  const [tl, tr, br, bl] = radii;
  if (!radii.some(Boolean)) return `255*${rectangle}`;
  const radius = `if(lt(X,${padding + width / 2}),if(lt(Y,${padding + height / 2}),${tl},${bl}),if(lt(Y,${padding + height / 2}),${tr},${br}))`;
  const rounded = `lte(pow(max(abs(X+0.5-${padding + width / 2})-${width / 2}+ld(0),0),2)+pow(max(abs(Y+0.5-${padding + height / 2})-${height / 2}+ld(0),0),2),ld(0)*ld(0))`;
  return `st(0,${radius});255*${rectangle}*if(${effectActiveExpression(frame, clip)},${rounded},1)`;
}

export function effectAmountExpression(
  effect: EffectTiming,
  clip: Clip,
  clock = "T",
) {
  if (!effect.enabled) return "0";
  const window = originalEffectWindow(effect, clip.duration);
  const duration = window.end - window.start;
  const origin = clip.start + window.start - (effect.timing?.offset ?? 0);
  const ratio = Math.min(
    1,
    duration / Math.max(duration, effect.easeIn + effect.easeOut),
  );
  const incoming = effect.easeIn * ratio,
    outgoing = effect.easeOut * ratio;
  return `(${effectActiveExpression(effect, clip, clock)})*${effect.intensity}*max(0,min(1,min(${incoming ? `(${clock}-${origin})/${incoming}` : "1"},${outgoing ? `(${origin + duration}-${clock})/${outgoing}` : "1"})))`;
}

/** Filters run after the content viewport and before frame scale/rotation. */
export async function visualEffectFilters(options: {
  clip: Clip;
  source: string;
  layer: number;
  width: number;
  height: number;
  fit: number;
  fps: number;
  duration: number;
  workDir: string;
  input: number;
  signal?: AbortSignal;
}) {
  const { clip, layer, width, height, fit, fps, duration, workDir } = options;
  const filters: string[] = [],
    args: string[] = [];
  let current = options.source,
    input = options.input,
    sequence = 0;
  const label = () => `fx${layer}_${sequence++}`;
  const add = (chain: string) => {
    const output = label();
    filters.push(`[${current}]${chain}[${output}]`);
    current = output;
  };
  const split = () => {
    const left = label(),
      right = label();
    filters.push(`[${current}]split=2[${left}][${right}]`);
    return [left, right];
  };
  const amount = (effect: EffectTiming) => effectAmountExpression(effect, clip);
  const active = (effect?: EffectTiming) =>
    !!effect?.enabled && effect.intensity > 0;
  const maskInput = async (
    region: Parameters<typeof regionSvg>[0],
    expression: (coverage: string) => string,
    mask = false,
  ) => {
    if (mask && hasMaskAnimation(clip)) {
      const file = await rasterizeMaskAnimation({
        clip,
        layer,
        workDir,
        width,
        height,
        fit,
        fps,
        duration,
        signal: options.signal,
      });
      args.push("-f", "concat", "-safe", "0", "-threads", "1", "-i", file);
    } else {
      const sampled = mask
        ? maskClipAt(clip, transformAt(clip, 0)).visualEffects!.mask!
        : region;
      const opacity = mask
        ? (sampled as NonNullable<Clip["visualEffects"]>["mask"])!.opacity
        : 0;
      const file = path.join(workDir, `region-${layer}-${sequence}.png`);
      await sharp(Buffer.from(regionSvg(sampled, width, height, 1 / fit)))
        .removeAlpha()
        .linear(1 - opacity, opacity * 255)
        .png()
        .toFile(file);
      args.push(...loopImageInput(file, fps, duration));
    }
    const output = label();
    filters.push(
      `[${input++}:v]format=gray,geq=lum='255*(${expression("lum(X,Y)/255")})'[${output}]`,
    );
    return output;
  };
  const key = clip.visualEffects?.["remove-color"];
  if (active(key)) {
    const e = key!;
    const color = rgb(e.color);
    const distance = `sqrt((${["r", "g", "b"].map((channel, i) => `pow(${channel}(X,Y)/255-${color[i]},2)`).join("+")})/3)`;
    const threshold = Math.max(0, Math.min(1, e.tolerance + e.defringe * 0.1));
    const normalized = `clip((${distance}-${threshold})/${Math.max(0.0001, e.softness)},0,1)`;
    const alpha = e.invert ? `(1-${normalized})` : normalized;
    const spill = `(${e.spill}*(1-${alpha})*(${amount(e)}))`;
    const luma = "(0.2126*r(X,Y)+0.7152*g(X,Y)+0.0722*b(X,Y))";
    add(
      `format=gbrap,geq=${["r", "g", "b"].map((channel) => `${channel}='${channel}(X,Y)*(1-${spill})+${luma}*${spill}'`).join(":")}:a='alpha(X,Y)*(1-(${amount(e)})*(1-${alpha}))'`,
    );
  }
  const tint = clip.visualEffects?.tint;
  if (active(tint)) {
    const e = tint!,
      color = rgb(e.color);
    const luma = "(0.2126*r(X,Y)+0.7152*g(X,Y)+0.0722*b(X,Y))";
    const normalized = `(${luma}/255)`;
    const range =
      e.range === "shadows"
        ? `max(0,1-${normalized}*2)`
        : e.range === "highlights"
          ? `max(0,${normalized}*2-1)`
          : e.range === "midtones"
            ? `max(0,1-abs(${normalized}*2-1))`
            : "1";
    const strength = `(${range}*${e.strength}*(${amount(e)}))`;
    add(
      `format=gbrap,geq=${["r", "g", "b"].map((channel, i) => `${channel}='${channel}(X,Y)*(1-${strength})+${luma}*${color[i]}*${strength}'`).join(":")}:a='alpha(X,Y)'`,
    );
  }
  const mask = clip.visualEffects?.mask;
  if (active(mask)) {
    const e = mask!;
    const coverage = await maskInput(
      e,
      (value) => `1-(${amount(e)})*(1-(${value}))`,
      true,
    );
    const [content, alphaSource] = split();
    const alpha = label(),
      product = label(),
      output = label();
    filters.push(`[${alphaSource}]alphaextract[${alpha}]`);
    filters.push(`[${alpha}][${coverage}]blend=all_expr='A*B/255'[${product}]`);
    filters.push(`[${content}][${product}]alphamerge,format=rgba[${output}]`);
    current = output;
  }
  const blur = clip.visualEffects?.["blur-region"];
  if (active(blur)) {
    const e = blur!,
      color = rgb(e.color);
    const coverage = await maskInput(e, (value) => `(${amount(e)})*(${value})`);
    const [original, blurred] = split();
    const rgbaCoverage = label();
    // maskedmerge reads one mask plane per output plane, including alpha.
    // A plain gray -> RGBA conversion would make alpha 255 outside the region.
    filters.push(
      `[${coverage}]format=gbrap,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='r(X,Y)'[${rgbaCoverage}]`,
    );
    const softened = label(),
      output = label();
    filters.push(
      `[${blurred}]${e.blur ? `gblur=sigma=${e.blur / fit / 2},` : ""}format=gbrap,geq=${["r", "g", "b"].map((channel, i) => `${channel}='${channel}(X,Y)*${1 - e.opacity}+${color[i] * 255 * e.opacity}'`).join(":")}:a='alpha(X,Y)'[${softened}]`,
    );
    filters.push(
      `[${original}][${softened}][${rgbaCoverage}]maskedmerge=planes=15[${output}]`,
    );
    current = output;
  }
  const padding = Math.ceil(visualEffectPadding(clip.visualEffects) / fit);
  if (padding)
    add(
      `format=rgba,pad=iw+${padding * 2}:ih+${padding * 2}:${padding}:${padding}:color=black@0`,
    );
  const border = clip.visualEffects?.border;
  if (active(border) && border!.width) {
    const e = border!,
      color = rgb(e.color);
    const [original, seed] = split();
    const grow = label(),
      inside = label(),
      expanded = label(),
      ring = label(),
      colored = label(),
      output = label();
    const frameAlpha = borderFrameAlpha(clip, width, height, fit, padding);
    filters.push(
      `[${seed}]format=gbrap,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${e.useAlpha ? "alpha(X,Y)" : frameAlpha}',alphaextract,split=2[${grow}][${inside}]`,
    );
    const dilations = Array.from(
      { length: Math.max(1, Math.ceil(e.width / fit)) },
      () => "dilation",
    ).join(",");
    filters.push(`[${grow}]${dilations}[${expanded}]`);
    filters.push(`[${expanded}][${inside}]blend=all_mode=subtract[${ring}]`);
    filters.push(
      `[${ring}]format=gbrap,geq=r=${color[0] * 255}:g=${color[1] * 255}:b=${color[2] * 255}:a='r(X,Y)*(${amount(e)})'[${colored}]`,
    );
    filters.push(`[${colored}][${original}]overlay=0:0:format=auto[${output}]`);
    current = output;
  }
  const shadow = clip.visualEffects?.shadow;
  if (active(shadow) && shadow!.opacity) {
    const e = shadow!,
      color = rgb(e.color),
      angle = (e.angle * Math.PI) / 180;
    const dx = (Math.cos(angle) * e.offset) / fit,
      dy = (-Math.sin(angle) * e.offset) / fit;
    const [original, seed] = split();
    const cast = label(),
      output = label();
    const sample = `if(between(X-${dx},0,W-1)*between(Y-${dy},0,H-1),alpha(X-${dx},Y-${dy}),0)`;
    filters.push(
      `[${seed}]format=gbrap,geq=r=${color[0] * 255}:g=${color[1] * 255}:b=${color[2] * 255}:a='${sample}*${e.opacity}*(${amount(e)})'${e.blur ? `,gblur=sigma=${e.blur / fit / 2}` : ""}[${cast}]`,
    );
    filters.push(`[${cast}][${original}]overlay=0:0:format=auto[${output}]`);
    current = output;
  }
  return {
    filters,
    args,
    label: current,
    inputCount: input - options.input,
    padding,
  };
}
