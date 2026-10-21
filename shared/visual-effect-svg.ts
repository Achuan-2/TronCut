import { type Clip, textFillDefaults } from "./model";
import {
  mediaFrameRadii,
  roundedRectanglePath,
  supportsMediaFrame,
} from "./media-frame";
import {
  effectAmount,
  keyAlpha,
  rgb,
  tintRange,
  type Region,
  type VisualEffects,
} from "./visual-effects";

type ShapeRegion = Pick<
  Region,
  | "x"
  | "y"
  | "width"
  | "height"
  | "shape"
  | "rotation"
  | "radius"
  | "feather"
  | "invert"
>;

/** An opaque luminance mask; the same geometry also feeds the export masks. */
export function regionSvg(
  region: ShapeRegion,
  width: number,
  height: number,
  scale: number,
) {
  const x = region.x * width,
    y = region.y * height;
  const w = region.width * width,
    h = region.height * height;
  const shape =
    region.shape === "ellipse"
      ? `<ellipse cx="${x}" cy="${y}" rx="${w / 2}" ry="${h / 2}"/>`
      : `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="${region.radius * scale}"/>`;
  const blur = (Math.abs(region.feather) * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><filter id="b" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="${blur}"/><feComponentTransfer><feFuncA type="linear" slope="2" intercept="${region.feather < 0 ? -1 : 0}"/></feComponentTransfer></filter></defs><rect width="100%" height="100%" fill="${region.invert ? "white" : "black"}"/><g fill="${region.invert ? "black" : "white"}" transform="rotate(${region.rotation} ${x} ${y})" ${blur ? 'filter="url(#b)"' : ""}>${shape}</g></svg>`;
}

const luminance = "0.2126 0.7152 0.0722";
const table = (fn: (value: number) => number, count = 256) =>
  Array.from({ length: count }, (_, index) =>
    Math.max(0, Math.min(1, fn(index / (count - 1)))).toFixed(6),
  ).join(" ");

/** Build SVG primitives in object pixels, keeping editor selection outside the filter. */
export function visualEffectSvg(
  clip: Clip,
  width: number,
  height: number,
  scale: number,
  time: number,
  id: string,
) {
  const effects = clip.visualEffects;
  if (!effects) return "";
  let current = "SourceGraphic",
    index = 0;
  const parts: string[] = [];
  const add = (tag: string, attrs: string, children = "") => {
    const result = `e${index++}`;
    parts.push(`<${tag} ${attrs} result="${result}">${children}</${tag}>`);
    return result;
  };
  const amount = (effect: Parameters<typeof effectAmount>[0]) =>
    effectAmount(effect, time, clip.duration);
  const mix = (a: string, b: string, mask: string) => {
    const left = add("feComposite", `in="${a}" in2="${mask}" operator="out"`);
    const right = add("feComposite", `in="${b}" in2="${mask}" operator="in"`);
    return add(
      "feComposite",
      `in="${left}" in2="${right}" operator="arithmetic" k2="1" k3="1"`,
    );
  };
  const regionMask = (
    region: ShapeRegion,
    alpha: (value: number) => number,
  ) => {
    const image = add(
      "feImage",
      `href="data:image/svg+xml,${encodeURIComponent(regionSvg(region, width, height, scale))}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none"`,
    );
    const mask = add("feColorMatrix", `in="${image}" type="luminanceToAlpha"`);
    return add(
      "feComponentTransfer",
      `in="${mask}"`,
      `<feFuncA type="table" tableValues="${table(alpha)}"/>`,
    );
  };
  const key = effects["remove-color"];
  if (key && amount(key)) {
    const squared = add(
      "feComponentTransfer",
      `in="${current}"`,
      rgb(key.color)
        .map(
          (value, channel) =>
            `<feFunc${["R", "G", "B"][channel]} type="table" tableValues="${table((v) => (v - value) ** 2)}"/>`,
        )
        .join(""),
    );
    const distance = add(
      "feColorMatrix",
      `in="${squared}" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.333333 0.333333 0.333333 0 0"`,
    );
    const mask = add(
      "feComponentTransfer",
      `in="${distance}"`,
      `<feFuncA type="table" tableValues="${table((v) => 1 - amount(key) + amount(key) * keyAlpha(key, Math.sqrt(v)), 1024)}"/>`,
    );
    if (key.spill) {
      const gray = add(
        "feColorMatrix",
        `in="${current}" type="saturate" values="0"`,
      );
      const spill = add(
        "feComponentTransfer",
        `in="${mask}"`,
        `<feFuncA type="table" tableValues="${table((v) => (1 - v) * key.spill)}"/>`,
      );
      current = mix(current, gray, spill);
    }
    current = add("feComposite", `in="${current}" in2="${mask}" operator="in"`);
  }
  const tint = effects.tint;
  if (tint && amount(tint) * tint.strength) {
    const colors = rgb(tint.color);
    const values = colors
      .map((c) => `${0.2126 * c} ${0.7152 * c} ${0.0722 * c} 0 0`)
      .join(" ");
    const tinted = add(
      "feColorMatrix",
      `in="${current}" values="${values} 0 0 0 1 0"`,
    );
    const luma = add(
      "feColorMatrix",
      `in="${current}" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${luminance} 0 0"`,
    );
    const mask = add(
      "feComponentTransfer",
      `in="${luma}"`,
      `<feFuncA type="table" tableValues="${table((v) => tintRange(tint.range, v) * tint.strength * amount(tint))}"/>`,
    );
    current = mix(current, tinted, mask);
  }
  const mask = effects.mask;
  if (mask && amount(mask)) {
    const coverage = regionMask(
      mask,
      (value) => 1 - amount(mask) * (1 - mask.opacity) * (1 - value),
    );
    current = add(
      "feComposite",
      `in="${current}" in2="${coverage}" operator="in"`,
    );
  }
  const blur = effects["blur-region"];
  if (blur && amount(blur)) {
    let blurred = add(
      "feGaussianBlur",
      `in="${current}" stdDeviation="${(blur.blur * scale) / 2}"`,
    );
    if (blur.opacity) {
      const color = rgb(blur.color);
      blurred = add(
        "feColorMatrix",
        `in="${blurred}" values="${[0, 1, 2].map((channel) => [0, 1, 2].map((i) => (i === channel ? 1 - blur.opacity : 0)).join(" ") + ` 0 ${color[channel] * blur.opacity}`).join(" ")} 0 0 0 1 0"`,
      );
    }
    const coverage = regionMask(blur, (value) => amount(blur) * value);
    current = mix(current, blurred, coverage);
  }
  const border = effects.border;
  if (border && amount(border) && border.width) {
    let source = current;
    if (!border.useAlpha) {
      const radii = supportsMediaFrame(clip)
        ? mediaFrameRadii(
            clip,
            { width: width / scale, height: height / scale },
            time,
          ).map((radius) => radius * scale)
        : [0, 0, 0, 0];
      const rect = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><path d="${roundedRectanglePath(width, height, radii)}" fill="white"/></svg>`;
      source = add(
        "feImage",
        `href="data:image/svg+xml,${encodeURIComponent(rect)}" x="0" y="0" width="${width}" height="${height}"`,
      );
    }
    const margin = visualEffectPadding(effects) * scale;
    const expanded = add(
      "feMorphology",
      `in="${source}" operator="dilate" radius="${border.width * scale}" x="${-margin}" y="${-margin}" width="${width + margin * 2}" height="${height + margin * 2}"`,
    );
    const ring = add(
      "feComposite",
      `in="${expanded}" in2="${source}" operator="out"`,
    );
    const color = add(
      "feFlood",
      `flood-color="${border.color}" flood-opacity="${amount(border)}"`,
    );
    const outline = add(
      "feComposite",
      `in="${color}" in2="${ring}" operator="in"`,
    );
    current = add(
      "feComposite",
      `in="${current}" in2="${outline}" operator="over"`,
    );
  }
  const shadow = effects.shadow;
  if (shadow && amount(shadow) * shadow.opacity) {
    const angle = (shadow.angle * Math.PI) / 180;
    const alpha = add(
      "feColorMatrix",
      `in="${current}" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"`,
    );
    const softened = add(
      "feGaussianBlur",
      `in="${alpha}" stdDeviation="${(shadow.blur * scale) / 2}"`,
    );
    const offset = add(
      "feOffset",
      `in="${softened}" dx="${Math.cos(angle) * shadow.offset * scale}" dy="${-Math.sin(angle) * shadow.offset * scale}"`,
    );
    const color = add(
      "feFlood",
      `flood-color="${shadow.color}" flood-opacity="${shadow.opacity * amount(shadow)}"`,
    );
    const cast = add(
      "feComposite",
      `in="${color}" in2="${offset}" operator="in"`,
    );
    current = add(
      "feComposite",
      `in="${current}" in2="${cast}" operator="over"`,
    );
  }
  if (!parts.length) parts.push('<feComposite in="SourceGraphic"/>');
  const fillPadding =
    clip.kind === "text" && clip.style?.fillEnabled !== false
      ? Math.max(
          clip.style?.fillPaddingX ?? textFillDefaults.fillPaddingX,
          clip.style?.fillPaddingY ?? textFillDefaults.fillPaddingY,
        )
      : 0;
  const padding = (visualEffectPadding(effects) + fillPadding) * scale;
  return `<filter id="${id}" x="${-padding}" y="${-padding}" width="${width + padding * 2}" height="${height + padding * 2}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">${parts.join("")}</filter>`;
}

export function visualEffectPadding(effects?: VisualEffects) {
  const shadow = effects?.shadow;
  const border = effects?.border;
  return Math.ceil(
    (shadow?.enabled ? shadow.offset + shadow.blur * 2 : 0) +
      (border?.enabled ? border.width : 0),
  );
}
