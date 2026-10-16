import { z } from "zod";
import type { Clip, Transform } from "./model";
import { referenceBehaviorPhases } from "./behavior-reference";

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
  type: z.enum(["whole", "forward", "backward", "center", "simultaneous"]),
  easing: z.enum([
    "linear",
    "quad-in",
    "quad-out",
    "quad-in-out",
    "spring",
    "bounce",
    "circular-out",
    "exponential-out",
  ]),
  direction: z.enum(["left", "right", "top", "bottom"]),
  speed: z.number().finite().min(1).max(100),
  offset: z.number().finite().min(0).max(2),
  intensity: z.number().finite().min(0).max(100).default(12),
  loopTime: z.number().finite().min(0.05).max(60).default(1),
  delay: z.number().finite().min(0).max(60).default(0),
  loops: z.number().int().min(1).max(1000).default(1),
  loopForever: z.boolean().default(true),
  tension: z.number().finite().min(0.1).max(20).default(7),
  shift: z.number().finite().min(0).max(100).default(5),
  // Exact phase lengths from authored presets; absent in older projects.
  duration: z.number().finite().min(0.001).max(60).optional(),
  rotation: z.number().finite().min(0).max(180).default(16),
  horizontal: z.number().finite().min(0).max(100).default(10),
  vertical: z.number().finite().min(0).max(100).default(10),
  frequency: z.number().finite().min(0.05).max(20).default(1),
});
export const behaviorSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  preset: z.string().max(100),
  // Keep applied custom presets readable even if their library entry is removed.
  name: z.string().trim().min(1).max(100).optional(),
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
  tension: 7,
  shift: 5,
  rotation: 16,
  horizontal: 10,
  vertical: 10,
  frequency: 1,
});
export const behaviorMovementOptions: readonly (readonly [
  BehaviorPhase["easing"],
  string,
])[] = [
  ["linear", "线性"],
  ["quad-in", "缓入 - 四次函数缓动"],
  ["quad-out", "缓出 - 四次函数缓动"],
  ["quad-in-out", "缓入缓出 - 四次函数缓动"],
  ["circular-out", "缓出 - 圆曲线缓动"],
  ["exponential-out", "缓出 - 指数函数缓动"],
  ["spring", "跳跃"],
  ["bounce", "回弹"],
];
export function shiftingPhase(
  key: BehaviorPhaseKey,
  kind: Clip["kind"],
): BehaviorPhase {
  const value = phase(
    "cut",
    kind === "text" ? (key === "during" ? "simultaneous" : "center") : "whole",
  );
  return {
    ...value,
    easing:
      key === "incoming"
        ? "spring"
        : key === "during"
          ? "circular-out"
          : "exponential-out",
    speed: key === "outgoing" ? 93 : 77,
    offset:
      kind === "text"
        ? key === "incoming"
          ? 0.02
          : key === "outgoing"
            ? 0.03
            : 0
        : 0,
    loopTime: 3.17,
    duration:
      key === "incoming" ? 91 / 60 : key === "outgoing" ? 13 / 30 : undefined,
    ...referenceBehaviorPhases.cut[key],
    ...(kind === "text" ? {} : { type: "whole" as const, offset: 0 }),
  };
}
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
  ["cut", "切换", "cut", "cut", "cut", "center"],
  ["pop", "弹出", "pop", "none", "pop", "forward"],
  ["sway", "摆动", "fade", "sway", "fade", "whole"],
  ["type-reveal", "文字逐个显示-显示", "reveal", "none", "reveal", "forward"],
  ["type-fade", "文字逐个显示-淡入", "fade", "none", "fade", "forward"],
  ["type-scale", "文字逐个显示-缩放", "scale", "none", "scale", "forward"],
  ["type-fly", "文字逐个显示-飞入", "fly", "none", "fly", "forward"],
  [
    "type-scatter",
    "文字逐个显示-结束散开（适合结尾）",
    "slide",
    "none",
    "explode",
    "forward",
  ],
  ["reveal", "显示", "reveal", "none", "reveal", "whole"],
  ["fade", "淡入淡出", "fade", "none", "fade", "whole"],
  ["slide", "滑动", "slide", "none", "slide", "whole"],
  ["fly", "飞入", "fly", "none", "fly", "forward"],
  ["drift", "漂移", "drift", "none", "drift", "whole"],
  ["explode", "爆炸", "explode", "none", "explode", "forward"],
  ["scale", "缩放", "scale", "none", "scale", "whole"],
  ["pulse", "脉动", "fade", "pulse", "fade", "whole"],
  ["bounce", "跳起和下落", "bounce", "none", "bounce", "forward"],
  ["shake", "颤动", "fade", "shake", "fade", "whole"],
  ["wave", "波浪", "fade", "wave", "fade", "forward"],
];
export const behaviorPresets: BehaviorPreset[] = presetDefinitions
  .map(([id, name, incoming, during, outgoing, type]) => ({
    id,
    name,
    incoming:
      id === "cut" ? shiftingPhase("incoming", "text") : phase(incoming, type),
    during:
      id === "cut" ? shiftingPhase("during", "text") : phase(during, type),
    outgoing:
      id === "cut" ? shiftingPhase("outgoing", "text") : phase(outgoing, type),
  }))
  .map((preset) => {
    const reference = referenceBehaviorPhases[preset.id];
    if (!reference) return preset;
    return {
      ...preset,
      incoming: { ...preset.incoming, ...reference.incoming },
      during: { ...preset.during, ...reference.during },
      outgoing: { ...preset.outgoing, ...reference.outgoing },
    };
  });

export function createBehavior(
  presetId: string,
  duration: number,
  kind: Clip["kind"] = "text",
): Behavior | null {
  const preset = behaviorPresets.find((item) => item.id === presetId);
  return preset ? behaviorFromPreset(preset, duration, kind) : null;
}

export function behaviorFromPreset(
  preset: BehaviorPreset,
  duration: number,
  kind: Clip["kind"] = "text",
): Behavior {
  const value: Behavior = {
    id: crypto.randomUUID(),
    preset: preset.id,
    enabled: true,
    start: 0,
    duration,
    incoming: { ...preset.incoming },
    during: { ...preset.during },
    outgoing: { ...preset.outgoing },
  };
  if (kind !== "text")
    for (const key of ["incoming", "during", "outgoing"] as const)
      value[key] = { ...value[key], type: "whole", offset: 0 };
  return value;
}
export const behaviorName = (behavior: Behavior) =>
  behavior.name ??
  behaviorPresets.find((item) => item.id === behavior.preset)?.name ??
  "行为";
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
  rotationX: number;
  rotationY: number;
  opacity: number;
}
export const neutralMotion = (): GlyphMotion => ({
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  rotationX: 0,
  rotationY: 0,
  opacity: 1,
});
function rankFor(type: BehaviorPhase["type"], index: number, count: number) {
  return type === "whole" || type === "simultaneous"
    ? 0
    : type === "backward"
      ? count - index - 1
      : type === "center"
        ? Math.floor(Math.abs(index - (count - 1) / 2))
        : index;
}
function phaseDelay(phase: BehaviorPhase, index: number, count: number) {
  // Simultaneous text keeps all glyphs together while offset delays the group.
  return (
    (phase.type === "simultaneous" ? 1 : rankFor(phase.type, index, count)) *
    phase.offset
  );
}
export function behaviorEase(
  p: number,
  easing: BehaviorPhase["easing"],
  tension = 7,
  seconds = 1,
) {
  if (p <= 0 || p >= 1) return Math.max(0, Math.min(1, p));
  switch (easing) {
    case "linear":
      return p;
    case "quad-in":
      return p ** 4;
    case "quad-in-out":
      return p < 0.5 ? 8 * p ** 4 : 1 - (-2 * p + 2) ** 4 / 2;
    case "spring":
      // Unit-mass damped spring, matching the reference stiffness of 50.
      // Use physical seconds so changing damping does not also change frequency.
      const damping = tension / 2,
        time = p * seconds;
      const delta = 50 - damping * damping;
      if (Math.abs(delta) < 1e-6)
        return 1 - Math.exp(-damping * time) * (1 + damping * time);
      const frequency = Math.sqrt(Math.abs(delta));
      if (delta > 0)
        return (
          1 -
          Math.exp(-damping * time) *
            (Math.cos(frequency * time) +
              (damping / frequency) * Math.sin(frequency * time))
        );
      const slow = -damping + frequency,
        fast = -damping - frequency;
      return (
        1 -
        (fast * Math.exp(slow * time) - slow * Math.exp(fast * time)) /
          (fast - slow)
      );
    case "circular-out":
      return Math.sqrt(Math.max(0, 1 - (p - 1) ** 2));
    case "exponential-out":
      return 1 - 2 ** (-10 * p);
    case "bounce":
      return 1 - Math.abs(Math.cos(p * Math.PI * 2.5)) * (1 - p) ** 2;
    default:
      return 1 - (1 - p) ** 4;
  }
}
export const phaseSeconds = (phase: BehaviorPhase) =>
  phase.duration ??
  (phase.style === "cut" && phase.easing === "spring"
    ? 0.7 + (20 - phase.tension) * 0.02
    : 0.12 + (100 - phase.speed) * 0.018);

export function changeBehaviorPhase(
  phase: BehaviorPhase,
  patch: Partial<BehaviorPhase>,
): BehaviorPhase {
  const next = { ...phase, ...patch };
  if (phase.duration !== undefined && patch.duration === undefined) {
    if (patch.speed !== undefined)
      next.duration = Math.min(
        60,
        Math.max(
          0.001,
          (phaseSeconds(phase) * (101 - patch.speed)) / (101 - phase.speed),
        ),
      );
    else if (patch.tension !== undefined && phase.easing === "spring")
      next.duration = Math.min(
        60,
        Math.max(0.001, (phaseSeconds(phase) * phase.tension) / patch.tension),
      );
  }
  return next;
}
export function behaviorWindows(behavior: Behavior, count: number) {
  const length = (p: BehaviorPhase) =>
    p.style === "none"
      ? 0
      : phaseSeconds(p) +
        Math.max(phaseDelay(p, 0, count), phaseDelay(p, count - 1, count));
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
  entering: boolean,
): GlyphMotion {
  const value = neutralMotion();
  const p = Math.max(0, Math.min(1, progress)),
    eased = behaviorEase(p, phase.easing, phase.tension, phaseSeconds(phase)),
    q = entering ? eased : 1 - eased,
    hidden = 1 - q;
  if (phase.style === "none") return value;
  if (phase.style === "fade" || phase.style === "reveal")
    value.opacity = Math.max(0, Math.min(1, q));
  else value.opacity = (entering ? p > 0 : p < 1) ? 1 : 0;
  if (phase.style === "cut")
    value.y =
      (phase.type === "whole" ? -12.5 : (index % 2 ? 1 : -1) * 1.25) * hidden;
  const distance = phase.style === "drift" ? 8 : 12;
  if (["slide", "drift"].includes(phase.style)) {
    if (phase.direction === "left" || phase.direction === "right")
      value.x = hidden * distance * (phase.direction === "left" ? -1 : 1);
    else value.y = hidden * distance * (phase.direction === "top" ? -1 : 1);
  }
  if (phase.style === "scale") value.scale = Math.max(0.01, q);
  if (phase.style === "pop") {
    const angle = (hidden * Math.PI) / 2;
    if (phase.direction === "left" || phase.direction === "right") {
      value.rotationY = hidden * 90;
      value.x =
        (1 - Math.cos(angle)) * (phase.direction === "left" ? -0.5 : 0.5);
    } else {
      value.rotationX = hidden * 90;
      value.y =
        (1 - Math.cos(angle)) * (phase.direction === "top" ? -0.5 : 0.5);
    }
  }
  if (phase.style === "fly") {
    // Fly-in is a perspective approach, not a directional slide.
    value.scale = 1 / Math.max(0.02, q);
    value.x = (index - (count - 1) / 2) * 0.65 * (value.scale - 1);
  }
  if (phase.style === "bounce")
    value.y = -3 * hidden - Math.abs(Math.sin(p * Math.PI * 3)) * hidden;
  if (phase.style === "drift") value.rotation = 25 * hidden;
  if (phase.style === "explode") {
    const angle = (-Math.PI * 3) / 4 + (index * Math.PI * 4) / 3;
    value.x = Math.cos(angle) * 12 * hidden;
    value.y = Math.sin(angle) * 12 * hidden;
    value.rotation = (index % 2 ? -90 : 90) * hidden;
    value.rotationY = 180 * hidden;
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
      const delay = phaseDelay(phase, index, count) * windows.ratio;
      const p =
        (elapsed - delay) /
        Math.max(0.001, phaseSeconds(phase) * windows.ratio);
      value = transition(
        phase,
        p,
        index,
        phase.type === "whole" ? 1 : count,
        incoming,
      );
    } else {
      const phase = behavior.during;
      const elapsed = time - windows.incoming - phaseDelay(phase, index, count);
      const period = phase.loopTime + phase.delay;
      const cycle = Math.floor((elapsed + 1e-9) / period),
        within = elapsed - cycle * period;
      if (
        elapsed < 0 ||
        (within >= phase.loopTime - 1e-9 && within < period - 1e-9) ||
        (!phase.loopForever && cycle >= phase.loops)
      )
        continue;
      const clock = behaviorEase(
        within / phase.loopTime,
        phase.easing,
        phase.tension,
        phase.loopTime,
      );
      const wave = Math.sin(clock * Math.PI * 2),
        envelope = (1 - Math.cos(clock * Math.PI * 2)) / 2,
        intensity = phase.intensity / 100;
      if (phase.style === "pulse" || phase.style === "scale")
        value.scale = 1 + intensity * envelope;
      else if (phase.style === "pop") {
        const angle = phase.rotation * envelope;
        const horizontal =
          phase.direction === "left" || phase.direction === "right";
        value[horizontal ? "rotationY" : "rotationX"] = angle;
        value[horizontal ? "x" : "y"] =
          (1 - Math.cos((angle * Math.PI) / 180)) *
          (["left", "top"].includes(phase.direction) ? -0.5 : 0.5);
      } else if (phase.style === "sway" || phase.style === "shake") {
        // Deterministic, smooth noise: seeking and rendering a frame must agree.
        const t =
          elapsed * phase.frequency * (phase.style === "shake" ? 12 : 1) +
          index * 0.37;
        value.x =
          ((phase.horizontal / 100) *
            (Math.sin(t * 2.3) + Math.sin(t * 3.7) * 0.5)) /
          1.5;
        value.y =
          ((phase.vertical / 100) *
            (Math.sin(t * 2.9) + Math.sin(t * 4.3) * 0.5)) /
          1.5;
        value.rotation =
          phase.rotation *
          (phase.style === "shake" ? 1 : 0) *
          Math.sin(t * 2.1);
      } else if (phase.style === "drift") {
        value.y = -intensity * wave;
        value.rotation = phase.rotation * wave;
      } else if (phase.style === "fade" || phase.style === "reveal")
        value.opacity = 1 - intensity * envelope;
      else if (phase.style === "cut")
        value.y =
          (phase.shift / 100) *
          wave *
          (phase.type === "whole" || phase.type === "simultaneous" || index % 2
            ? 1
            : -1);
      else if (phase.style !== "none") value.y = -intensity * wave;
    }
    result.x += value.x;
    result.y += value.y;
    result.rotation += value.rotation;
    result.rotationX += value.rotationX;
    result.rotationY += value.rotationY;
    result.scale *= value.scale;
    result.opacity *= value.opacity;
  }
  return result;
}

export function clipsBehaviorText(
  clip: Pick<Clip, "behaviors">,
  localTime: number,
  count: number,
) {
  return (
    clip.behaviors?.some((behavior) => {
      const time = localTime - behavior.start;
      if (!behavior.enabled || time < 0 || time >= behavior.duration)
        return false;
      const windows = behaviorWindows(behavior, count);
      const phase =
        time < windows.incoming
          ? behavior.incoming
          : time >= behavior.duration - windows.outgoing
            ? behavior.outgoing
            : behavior.during;
      return phase.style === "cut" && phase.type !== "whole";
    }) ?? false
  );
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
    rotationX: (transform.rotationX ?? 0) + motion.rotationX,
    rotationY: (transform.rotationY ?? 0) + motion.rotationY,
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
