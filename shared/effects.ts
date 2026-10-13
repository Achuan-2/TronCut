import type { Clip } from "./model";

export const defaultEffects = {
  brightness: 1,
  contrast: 1,
  saturation: 1,
  blur: 0,
  grayscale: false,
  flipX: false,
  flipY: false,
};
export const defaultCrop = { left: 0, top: 0, right: 0, bottom: 0 };
export const effectPresets = [
  { name: "原始画面", effects: { ...defaultEffects } },
  { name: "黑白", effects: { ...defaultEffects, grayscale: true } },
  {
    name: "鲜明",
    effects: { ...defaultEffects, contrast: 1.15, saturation: 1.3 },
  },
  {
    name: "柔和",
    effects: {
      ...defaultEffects,
      brightness: 1.08,
      contrast: 0.9,
      saturation: 0.85,
    },
  },
  { name: "背景模糊", effects: { ...defaultEffects, blur: 8 } },
];

export function fadeDurations(clip: Clip) {
  // If fades overlap, reduce both proportionally rather than making a discontinuity.
  const incoming = Math.max(0, clip.fadeIn ?? 0),
    outgoing = Math.max(0, clip.fadeOut ?? 0);
  const ratio = Math.min(
    1,
    clip.duration / Math.max(clip.duration, incoming + outgoing),
  );
  return { incoming: incoming * ratio, outgoing: outgoing * ratio };
}

export function fadeOpacity(clip: Clip, localTime: number): number {
  const { incoming, outgoing } = fadeDurations(clip);
  return Math.max(
    0,
    Math.min(
      1,
      incoming ? localTime / incoming : 1,
      outgoing ? (clip.duration - localTime) / outgoing : 1,
    ),
  );
}

export function previewFilter(clip: Clip): string {
  const e = clip.effects ?? defaultEffects;
  return `brightness(${e.brightness}) contrast(${e.contrast}) saturate(${e.grayscale ? 0 : e.saturation}) blur(${e.blur}px)`;
}

/** LUT-free filters matching the preview's brightness/contrast/saturation operations. */
export function visualFilters(
  clip: Clip,
  width: number,
  height: number,
): string[] {
  const result: string[] = [],
    crop = clip.crop ?? defaultCrop,
    e = clip.effects ?? defaultEffects;
  if (Object.values(crop).some(Boolean)) {
    const left = Math.floor(width * crop.left),
      top = Math.floor(height * crop.top);
    result.push(
      `crop=w=${Math.max(1, width - left - Math.floor(width * crop.right))}:h=${Math.max(1, height - top - Math.floor(height * crop.bottom))}:x=${left}:y=${top}:exact=1`,
    );
  }
  if (e.brightness !== 1 || e.contrast !== 1) {
    const gain = e.brightness * e.contrast;
    const offset = 255 * 0.5 * (1 - e.contrast);
    result.push(
      `lutrgb=r='clip(val*${gain}+${offset},0,255)':g='clip(val*${gain}+${offset},0,255)':b='clip(val*${gain}+${offset},0,255)'`,
    );
  }
  if (e.grayscale || e.saturation !== 1)
    result.push(`hue=s=${e.grayscale ? 0 : e.saturation}`);
  if (e.blur) result.push(`gblur=sigma=${e.blur}`);
  if (e.flipX) result.push("hflip");
  if (e.flipY) result.push("vflip");
  return result;
}
