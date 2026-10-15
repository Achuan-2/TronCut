import { z } from "zod";
import type { Clip, Transform } from "./model";

export const behaviorStyles = [
  "none",
  "reveal",
  "fade",
  "pop",
  "slide",
  "fly",
  "drift",
  "scale",
  "bounce",
  "explode",
  "cut",
  "pulse",
  "sway",
  "shake",
  "wave",
] as const;
export const behaviorStyleLabels: Record<BehaviorStyle, string> = {
  none: "无",
  reveal: "显示",
  fade: "淡入淡出",
  pop: "弹出",
  slide: "滑动",
  fly: "飞入",
  drift: "漂移",
  scale: "缩放",
  bounce: "跳起和下落",
  explode: "爆炸",
  cut: "切换",
  pulse: "脉动",
  sway: "摆动",
  shake: "颤动",
  wave: "波浪",
};
export const behaviorPhaseSchema = z.object({
  style: z.enum(behaviorStyles),
  type: z.enum(["whole", "forward", "backward", "center"]),
  easing: z.enum([
    "linear",
    "quad-in",
    "quad-out",
    "quad-in-out",
    "spring",
    "bounce",
  ]),
  direction: z.enum(["left", "right", "top", "bottom"]),
  speed: z.number().finite().min(1).max(100),
  offset: z.number().finite().min(0).max(2),
  intensity: z.number().finite().min(0).max(100).default(12),
  loopTime: z.number().finite().min(0.05).max(60).default(1),
  delay: z.number().finite().min(0).max(60).default(0),
  loops: z.number().int().min(1).max(1000).default(1),
  loopForever: z.boolean().default(true),
});
export const behaviorSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  preset: z.string().max(100),
  enabled: z.boolean(),
  // Normal clips start at zero. A frame snapshot shifts the clock backwards
  // while retaining the original duration so it captures the current phase.
  start: z.number().finite().min(-86400).max(86400),
  duration: z.number().finite().positive().max(86400),
  incoming: behaviorPhaseSchema,
  during: behaviorPhaseSchema,
  outgoing: behaviorPhaseSchema,
});
export type Behavior = z.infer<typeof behaviorSchema>;
export type BehaviorPhase = z.infer<typeof behaviorPhaseSchema>;
export type BehaviorStyle = (typeof behaviorStyles)[number];
export type BehaviorPhaseKey = "incoming" | "during" | "outgoing";

const phase = (
  style: BehaviorStyle,
  type: BehaviorPhase["type"] = "whole",
): BehaviorPhase => ({
  style,
  type,
  easing: "quad-out",
  direction: "left",
  speed: 77,
  offset: type === "whole" ? 0 : 0.09,
  intensity: 12,
  loopTime: 1,
  delay: 0,
  loops: 1,
  loopForever: true,
});
export interface BehaviorPreset {
  id: string;
  name: string;
  incoming: BehaviorPhase;
  during: BehaviorPhase;
  outgoing: BehaviorPhase;
}
const presetDefinitions: readonly (readonly [
  string,
  string,
  BehaviorStyle,
  BehaviorStyle,
  BehaviorStyle,
  BehaviorPhase["type"],
])[] = [
  ["cut", "切换", "cut", "none", "cut", "whole"],
  ["pop", "弹出", "pop", "none", "pop", "forward"],
  ["sway", "摆动", "fade", "sway", "fade", "whole"],
  ["type-reveal", "文字逐个显示-显示", "reveal", "none", "reveal", "forward"],
  ["type-fade", "文字逐个显示-淡入", "fade", "none", "fade", "forward"],
  ["type-scale", "文字逐个显示-缩放", "scale", "none", "scale", "forward"],
  ["type-fly", "文字逐个显示-飞入", "fly", "none", "fly", "forward"],
  ["reveal", "显示", "reveal", "none", "reveal", "whole"],
  ["fade", "淡入淡出", "fade", "none", "fade", "whole"],
  ["slide", "滑动", "slide", "none", "slide", "whole"],
  ["drift", "漂移", "drift", "none", "drift", "whole"],
  ["explode", "爆炸", "explode", "none", "explode", "forward"],
  ["scale", "缩放", "scale", "none", "scale", "whole"],
  ["pulse", "脉动", "fade", "pulse", "fade", "whole"],
  ["bounce", "跳起和下落", "bounce", "none", "bounce", "forward"],
  ["shake", "颤动", "fade", "shake", "fade", "whole"],
  ["wave", "波浪", "fade", "wave", "fade", "forward"],
];
export const behaviorPresets: BehaviorPreset[] = presetDefinitions.map(
  ([id, name, incoming, during, outgoing, type]) => ({
    id,
    name,
    incoming: phase(incoming, type),
    during: phase(during, type),
    outgoing: phase(outgoing, type),
  }),
);

export function createBehavior(
  presetId: string,
  duration: number,
  kind: Clip["kind"] = "text",
): Behavior | null {
  const preset = behaviorPresets.find((item) => item.id === presetId);
  const value = preset
    ? {
        id: crypto.randomUUID(),
        preset: preset.id,
        enabled: true,
        start: 0,
        duration,
        incoming: { ...preset.incoming },
        during: { ...preset.during },
        outgoing: { ...preset.outgoing },
      }
    : null;
  if (value && kind !== "text")
    for (const key of ["incoming", "during", "outgoing"] as const)
      value[key] = { ...value[key], type: "whole", offset: 0 };
  return value;
}
export const behaviorName = (behavior: Behavior) =>
  behaviorPresets.find((item) => item.id === behavior.preset)?.name ?? "行为";
export const supportsBehaviors = (clip: Pick<Clip, "kind">) =>
  clip.kind !== "audio";
export const hasBehaviors = (clip: Clip) =>
  supportsBehaviors(clip) && !!clip.behaviors?.length;
export const behaviorGlyphCount = (clip: Pick<Clip, "kind" | "text">) =>
  clip.kind === "text"
    ? Math.max(1, textGlyphs((clip.text ?? "").replace(/\n/g, "")).length)
    : 1;
export const shiftBehaviors = (clip: Clip, delta: number) =>
  clip.behaviors?.map((behavior) => ({
    ...behavior,
    start: behavior.start - delta,
  }));
export function fitBehaviorDuration(clip: Clip): Clip {
  if (
    !clip.behaviors?.some(
      (behavior) => behavior.start !== 0 || behavior.duration !== clip.duration,
    )
  )
    return clip;
  return {
    ...clip,
    behaviors: clip.behaviors.map((behavior) => ({
      ...behavior,
      start: 0,
      duration: clip.duration,
    })),
  };
}

// Segment graphemes so emoji, combining marks and Chinese characters animate as
// complete visible units. Newlines occupy layout rows but never stagger slots.
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export function textGlyphs(text: string): string[] {
  return Array.from(segmenter.segment(text), (part) => part.segment);
}
export interface GlyphMotion {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
}
export const neutralMotion = (): GlyphMotion => ({
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  opacity: 1,
});
function rankFor(type: BehaviorPhase["type"], index: number, count: number) {
  return type === "whole"
    ? 0
    : type === "backward"
      ? count - index - 1
      : type === "center"
        ? Math.abs(index - (count - 1) / 2)
        : index;
}
function ease(p: number, easing: BehaviorPhase["easing"]) {
  if (p <= 0 || p >= 1) return Math.max(0, Math.min(1, p));
  switch (easing) {
    case "linear":
      return p;
    case "quad-in":
      return p ** 4;
    case "quad-in-out":
      return p < 0.5 ? 8 * p ** 4 : 1 - (-2 * p + 2) ** 4 / 2;
    case "spring":
      return 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2;
    case "bounce":
      return 1 - Math.abs(Math.cos(p * Math.PI * 2.5)) * (1 - p) ** 2;
    default:
      return 1 - (1 - p) ** 4;
  }
}
export const phaseSeconds = (phase: BehaviorPhase) =>
  0.12 + (100 - phase.speed) * 0.018;
export function behaviorWindows(behavior: Behavior, count: number) {
  const length = (p: BehaviorPhase) =>
    p.style === "none"
      ? 0
      : phaseSeconds(p) +
        (p.type === "whole" ? 0 : Math.max(0, count - 1) * p.offset);
  const incoming = length(behavior.incoming),
    outgoing = length(behavior.outgoing);
  const ratio = Math.min(
    1,
    behavior.duration / Math.max(0.001, incoming + outgoing),
  );
  return { incoming: incoming * ratio, outgoing: outgoing * ratio, ratio };
}
function transition(
  phase: BehaviorPhase,
  progress: number,
  index: number,
  count: number,
): GlyphMotion {
  const value = neutralMotion();
  const p = Math.max(0, Math.min(1, progress)),
    q = ease(p, phase.easing),
    hidden = 1 - q;
  if (phase.style === "none") return value;
  value.opacity =
    phase.style === "reveal" || phase.style === "cut" ? (p > 0 ? 1 : 0) : p;
  if (phase.style === "fade") value.opacity = Math.max(0, Math.min(1, q));
  const distance =
    phase.style === "fly" ? 5 : phase.style === "drift" ? 2 : 1.5;
  if (["slide", "fly", "drift"].includes(phase.style)) {
    if (phase.direction === "left" || phase.direction === "right")
      value.x = hidden * distance * (phase.direction === "left" ? -1 : 1);
    else value.y = hidden * distance * (phase.direction === "top" ? -1 : 1);
  }
  if (phase.style === "pop" || phase.style === "scale")
    value.scale = Math.max(0.01, q);
  if (phase.style === "bounce")
    value.y = -3 * hidden - Math.abs(Math.sin(p * Math.PI * 3)) * hidden;
  if (phase.style === "drift") value.rotation = -20 * hidden;
  if (phase.style === "explode") {
    const angle = (index / Math.max(1, count)) * Math.PI * 2;
    value.x = Math.cos(angle) * 5 * hidden;
    value.y = Math.sin(angle) * 5 * hidden;
    value.rotation = 180 * hidden;
    value.scale = 1 + hidden;
  }
  return value;
}
export function glyphMotion(
  clip: Pick<Clip, "behaviors">,
  localTime: number,
  index: number,
  count: number,
  scope: "object" | "text" | "all" = "all",
): GlyphMotion {
  const result = neutralMotion();
  for (const behavior of clip.behaviors ?? []) {
    const time = localTime - behavior.start;
    if (!behavior.enabled || time < 0 || time >= behavior.duration) continue;
    const windows = behaviorWindows(behavior, count);
    let value = neutralMotion();
    const incoming = time < windows.incoming;
    const outgoing = time >= behavior.duration - windows.outgoing;
    const activePhase = incoming
      ? behavior.incoming
      : outgoing
        ? behavior.outgoing
        : behavior.during;
    if (
      scope !== "all" &&
      (activePhase.type === "whole") !== (scope === "object")
    )
      continue;
    if (incoming || outgoing) {
      const phase = incoming ? behavior.incoming : behavior.outgoing;
      const elapsed = incoming
        ? time
        : time - (behavior.duration - windows.outgoing);
      const delay =
        rankFor(phase.type, index, count) * phase.offset * windows.ratio;
      const p =
        (elapsed - delay) /
        Math.max(0.001, phaseSeconds(phase) * windows.ratio);
      value = transition(phase, incoming ? p : 1 - p, index, count);
    } else {
      const phase = behavior.during;
      const elapsed =
        time -
        windows.incoming -
        rankFor(phase.type, index, count) * phase.offset;
      const period = phase.loopTime + phase.delay;
      const cycle = Math.floor(elapsed / period),
        within = elapsed - cycle * period;
      if (
        elapsed < 0 ||
        within >= phase.loopTime ||
        (!phase.loopForever && cycle >= phase.loops)
      )
        continue;
      const clock = ease(within / phase.loopTime, phase.easing);
      const wave = Math.sin(clock * Math.PI * 2),
        intensity = phase.intensity / 100;
      if (
        phase.style === "pulse" ||
        phase.style === "scale" ||
        phase.style === "pop"
      )
        value.scale = 1 + intensity * wave;
      else if (phase.style === "sway" || phase.style === "drift")
        value.rotation = phase.intensity * wave;
      else if (phase.style === "shake")
        value.x = intensity * Math.sin(clock * Math.PI * 14);
      else if (
        phase.style === "fade" ||
        phase.style === "reveal" ||
        phase.style === "cut"
      )
        value.opacity = 1 - intensity * (0.5 + 0.5 * wave);
      else if (phase.style !== "none") value.y = -intensity * wave;
    }
    result.x += value.x;
    result.y += value.y;
    result.rotation += value.rotation;
    result.scale *= value.scale;
    result.opacity *= value.opacity;
  }
  return result;
}
export function behaviorTransform(
  clip: Pick<Clip, "kind" | "text" | "behaviors">,
  transform: Transform,
  localTime: number,
): Transform {
  const motion = glyphMotion(
    clip,
    localTime,
    0,
    behaviorGlyphCount(clip),
    "object",
  );
  return {
    ...transform,
    x: transform.x + motion.x * 0.08,
    y: transform.y + motion.y * 0.08,
    scale: Math.max(0.01, transform.scale * motion.scale),
    opacity: transform.opacity * motion.opacity,
    rotation: (transform.rotation ?? 0) + motion.rotation,
  };
}

export interface LayoutGlyph {
  text: string;
  x: number;
  y: number;
  width: number;
  index: number;
}
export function layoutGlyphs(
  text: string,
  fontSize: number,
  measure: (text: string) => number,
) {
  const lines = text.split("\n"),
    lineHeight = fontSize * 1.25;
  const width = Math.max(16, ...lines.map(measure)),
    height = Math.max(16, lines.length * lineHeight);
  let index = 0;
  const glyphs: LayoutGlyph[] = [];
  lines.forEach((line, row) => {
    let prefix = "";
    const left = (width - measure(line)) / 2;
    for (const text of textGlyphs(line)) {
      const x = left + measure(prefix),
        glyphWidth = measure(text);
      glyphs.push({
        text,
        x: x + glyphWidth / 2,
        y: (row + 0.5) * lineHeight,
        width: glyphWidth,
        index: index++,
      });
      prefix += text;
    }
  });
  return { width, height, glyphs, count: index };
}
