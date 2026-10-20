import { z } from "zod";
import type { Clip, Project, Transform } from "./model";
import { invalidateTransitionIndex, transitionIndex } from "./transition-index";

export const transitionTypeSchema = z.enum([
  "smooth-slide",
  "zoom",
  "fade",
  "whip-pan",
]);
export type TransitionType = z.infer<typeof transitionTypeSchema>;
export const transitionPresets: { type: TransitionType; name: string }[] = [
  { type: "smooth-slide", name: "平滑切换" },
  { type: "zoom", name: "放大" },
  { type: "fade", name: "淡入淡出" },
  { type: "whip-pan", name: "横扫" },
];
export const transitionName = (type: TransitionType) =>
  transitionPresets.find((preset) => preset.type === type)!.name;

export const transitionSchema = z.object({
  type: transitionTypeSchema,
  duration: z.number().finite().positive().max(60),
  enabled: z.boolean(),
  reverse: z.boolean(),
  pairId: z.string().max(128).optional(),
});
export type Transition = z.infer<typeof transitionSchema>;
export type TransitionSide = "incoming" | "outgoing";
export type TransitionSelection = { clipId: string; side: TransitionSide };
export type TransitionTarget = TransitionSelection & {
  both?: boolean;
  neighborId?: string;
};
export const transitionMime = "troncut-transition";
export const transitionSides: TransitionSide[] = ["incoming", "outgoing"];
export const supportsTransitions = (clip: Clip) => clip.kind !== "audio";
const opposite = (side: TransitionSide): TransitionSide =>
  side === "incoming" ? "outgoing" : "incoming";
const editable = (project: Project, clip: Clip) =>
  supportsTransitions(clip) &&
  project.tracks.some((track) => track.id === clip.trackId && !track.locked);

export function adjacentClip(
  project: Project,
  clip: Clip,
  side: TransitionSide,
) {
  return transitionIndex(project).adjacent(clip, side);
}

/** Edge drops at a cut address both clips; middle drops address both ends. */
export function transitionDropTarget(
  project: Project,
  clip: Clip,
  x: number,
  width: number,
): TransitionTarget | null {
  if (!editable(project, clip) || width <= 0) return null;
  const side: TransitionSide = x < width / 2 ? "incoming" : "outgoing";
  const neighbor = adjacentClip(project, clip, side);
  if (neighbor && Math.min(x, width - x) <= Math.min(12, width / 4))
    return { clipId: clip.id, side, neighborId: neighbor.id };
  return {
    clipId: clip.id,
    side,
    ...(x >= width / 3 && x <= (width * 2) / 3 ? { both: true } : {}),
  };
}

export function transitionTargets(
  target: TransitionTarget,
): TransitionSelection[] {
  return [
    { clipId: target.clipId, side: target.side },
    ...(target.both
      ? [{ clipId: target.clipId, side: opposite(target.side) }]
      : []),
    ...(target.neighborId
      ? [{ clipId: target.neighborId, side: opposite(target.side) }]
      : []),
  ];
}

export function pairedTransition(
  project: Project,
  clip: Clip,
  side: TransitionSide,
) {
  const transition = clip.transitions?.[side];
  if (!transition?.pairId) return undefined;
  const members = transitionIndex(project).pairs.get(transition.pairId) ?? [];
  const neighbor = adjacentClip(project, clip, side);
  return members.length === 2 &&
    members.some(
      (member) => member.clip.id === clip.id && member.side === side,
    ) &&
    members.some(
      (member) =>
        member.clip.id === neighbor?.id && member.side === opposite(side),
    )
    ? neighbor
    : undefined;
}

/** Each end uses at most half a clip, so incoming and outgoing never collide. */
export function transitionDuration(
  project: Project,
  clip: Clip,
  side: TransitionSide,
) {
  const transition = clip.transitions?.[side];
  if (!transition) return 0;
  const pair = pairedTransition(project, clip, side);
  return Math.min(
    transition.duration,
    pair ? Math.min(clip.duration, pair.duration) : clip.duration / 2,
  );
}
export function transitionMarkerDuration(
  project: Project,
  clip: Clip,
  side: TransitionSide,
) {
  return (
    transitionDuration(project, clip, side) /
    (pairedTransition(project, clip, side) ? 2 : 1)
  );
}

export function normalizeTransitions(project: Project): Project {
  invalidateTransitionIndex(project);
  let changed = false;
  const clips = project.clips.map((clip) => {
    if (!clip.transitions) return clip;
    const transitions = { ...clip.transitions };
    let edited = false;
    for (const side of transitionSides) {
      const current = transitions[side];
      if (!current) continue;
      const pairId = pairedTransition(project, clip, side)
        ? current.pairId
        : undefined;
      const duration = transitionDuration(project, clip, side);
      if (duration !== current.duration || pairId !== current.pairId) {
        transitions[side] = { ...current, duration, pairId };
        edited = true;
      }
    }
    changed ||= edited;
    return edited ? { ...clip, transitions } : clip;
  });
  return changed ? { ...project, clips } : project;
}

export function addTransition(
  project: Project,
  target: TransitionTarget,
  duration = 1,
  type: TransitionType = "smooth-slide",
): Project {
  const endpoints = transitionTargets(target);
  if (
    !endpoints.every((item) => {
      const clip = project.clips.find((c) => c.id === item.clipId);
      return clip && editable(project, clip);
    })
  )
    return project;
  const clip = project.clips.find((c) => c.id === target.clipId)!;
  if (
    target.neighborId &&
    adjacentClip(project, clip, target.side)?.id !== target.neighborId
  )
    return project;
  const pairId = target.neighborId ? crypto.randomUUID() : undefined;
  return normalizeTransitions({
    ...project,
    clips: project.clips.map((c) => {
      const sides = endpoints.filter((item) => item.clipId === c.id);
      if (!sides.length) return c;
      const transitions = { ...c.transitions };
      for (const { side } of sides)
        transitions[side] = {
          type,
          duration,
          enabled: true,
          reverse: false,
          pairId,
        };
      return { ...c, transitions };
    }),
  });
}

export function updateTransition(
  project: Project,
  selection: TransitionSelection,
  patch: Partial<Omit<Transition, "pairId">> | null,
): Project {
  const clip = project.clips.find((c) => c.id === selection.clipId);
  const current = clip?.transitions?.[selection.side];
  if (!clip || !current || !editable(project, clip)) return project;
  const pair = pairedTransition(project, clip, selection.side);
  return normalizeTransitions({
    ...project,
    clips: project.clips.map((c) => {
      const side =
        c.id === clip.id
          ? selection.side
          : c.id === pair?.id
            ? opposite(selection.side)
            : undefined;
      if (!side) return c;
      const transitions = { ...c.transitions };
      if (patch) transitions[side] = { ...transitions[side]!, ...patch };
      else delete transitions[side];
      return {
        ...c,
        transitions:
          transitions.incoming || transitions.outgoing
            ? transitions
            : undefined,
      };
    }),
  });
}

function transitionWindows(project: Project, clip: Clip) {
  return transitionSides.flatMap((side) => {
    const transition = clip.transitions?.[side];
    if (!transition?.enabled) return [];
    const pair = pairedTransition(project, clip, side);
    if (pair && !pair.transitions?.[opposite(side)]?.enabled) return [];
    const duration = transitionDuration(project, clip, side);
    const cut = side === "incoming" ? clip.start : clip.start + clip.duration;
    const start = pair
      ? cut - duration / 2
      : side === "incoming"
        ? cut
        : cut - duration;
    return [
      {
        side,
        type: transition.type,
        start,
        duration,
        direction: transition.reverse ? -1 : 1,
        paired: !!pair,
        // The lower layer stays opaque during a dissolve, preventing a dip to
        // the canvas background. Clip array order is also the render order.
        fade:
          !pair ||
          transitionIndex(project).positions.get(clip.id)! >
            transitionIndex(project).positions.get(pair.id)!,
      },
    ];
  });
}

export function transitionRange(project: Project, clip: Clip) {
  let before = 0,
    after = 0;
  for (const window of transitionWindows(project, clip))
    if (window.paired) {
      if (window.side === "incoming") before = window.duration / 2;
      else after = window.duration / 2;
    }
  return {
    before,
    after,
    start: clip.start - before,
    end: clip.start + clip.duration + after,
  };
}

export function transitionOffset(project: Project, clip: Clip, time: number) {
  return transitionVisual(project, clip, time).x;
}

/** Horizontal shutter smear, proportional to the cubic pan's velocity. */
export function whipPanBlur(progress: number) {
  const p = Math.max(0, Math.min(1, progress));
  return 0.04 * 4 * Math.min(p, 1 - p) ** 2;
}

/** Gaussian sigma as a fraction of the layer width, before its transform. */
export function transitionBlur(project: Project, clip: Clip, time: number) {
  return transitionWindows(project, clip).reduce(
    (blur, window) =>
      window.type === "whip-pan"
        ? Math.max(blur, whipPanBlur((time - window.start) / window.duration))
        : blur,
    0,
  );
}

export function transitionBlurExpression(
  project: Project,
  clip: Clip,
  clock = "t",
) {
  const terms = transitionWindows(project, clip)
    .filter((window) => window.type === "whip-pan")
    .map((window) => {
      const p = `clip(((${clock})-(${window.start}))/${window.duration},0,1)`;
      return `(0.04*4*pow(min(${p},1-(${p})),2))`;
    });
  return terms.reduce((result, term) => `max(${result},${term})`, "0");
}

/** Normalized offsets and multipliers shared by preview and frame capture. */
export function transitionVisual(project: Project, clip: Clip, time: number) {
  const visual = { x: 0, scale: 1, scaleX: 1, opacity: 1 };
  for (const window of transitionWindows(project, clip)) {
    const p = Math.max(0, Math.min(1, (time - window.start) / window.duration));
    const eased =
      window.type === "whip-pan"
        ? p < 0.5
          ? 4 * p ** 3
          : 1 - 4 * (1 - p) ** 3
        : p * p * (3 - 2 * p);
    const amount = window.side === "incoming" ? 1 - eased : eased;
    switch (window.type) {
      case "smooth-slide":
      case "whip-pan":
        visual.x +=
          window.direction * (window.side === "incoming" ? amount : -amount);
        if (window.type === "whip-pan")
          visual.scaleX *= 1 + 0.16 * 4 * p * (1 - p);
        break;
      case "zoom":
        visual.scale *=
          1 +
          window.direction *
            (window.side === "incoming" ? -0.28 : 0.28) *
            amount;
        if (window.fade) visual.opacity *= 1 - amount;
        break;
      case "fade":
        if (window.fade) visual.opacity *= 1 - amount;
        break;
    }
  }
  return visual;
}
export function transitionTransform(
  project: Project,
  clip: Clip,
  transform: Transform,
  time: number,
): Transform {
  const visual = transitionVisual(project, clip, time);
  return {
    ...transform,
    x: transform.x + visual.x,
    scale:
      visual.scale === 1
        ? transform.scale
        : Math.min(8, transform.scale * visual.scale),
    ...(visual.scaleX !== 1
      ? { scaleX: Math.min(8, (transform.scaleX ?? 1) * visual.scaleX) }
      : {}),
    opacity: transform.opacity * visual.opacity,
  };
}

/** Same curves as transitionVisual; FFmpeg uses global timeline seconds. */
export function transitionVisualExpressions(
  project: Project,
  clip: Clip,
  clock = "t",
) {
  const terms: Record<"x" | "scale" | "scaleX" | "opacity", string[]> = {
    x: [],
    scale: [],
    scaleX: [],
    opacity: [],
  };
  for (const window of transitionWindows(project, clip)) {
    const p = `clip(((${clock})-(${window.start}))/${window.duration},0,1)`;
    const eased =
      window.type === "whip-pan"
        ? `if(lt(${p},0.5),4*pow(${p},3),1-4*pow(1-(${p}),3))`
        : `((${p})*(${p})*(3-2*(${p})))`;
    const amount = window.side === "incoming" ? `(1-(${eased}))` : `(${eased})`;
    switch (window.type) {
      case "smooth-slide":
      case "whip-pan":
        terms.x.push(
          `(${window.direction * (window.side === "incoming" ? 1 : -1)}*${amount})`,
        );
        if (window.type === "whip-pan")
          terms.scaleX.push(`(1+0.16*4*(${p})*(1-(${p})))`);
        break;
      case "zoom":
        terms.scale.push(
          `(1+${window.direction * (window.side === "incoming" ? -0.28 : 0.28)}*${amount})`,
        );
        if (window.fade) terms.opacity.push(`(1-${amount})`);
        break;
      case "fade":
        if (window.fade) terms.opacity.push(`(1-${amount})`);
        break;
    }
  }
  return {
    x: terms.x.join("+") || "0",
    scale: terms.scale.join("*") || "1",
    scaleX: terms.scaleX.join("*") || "1",
    opacity: terms.opacity.join("*") || "1",
  };
}

export function transitionOffsetExpression(
  project: Project,
  clip: Clip,
  clock = "t",
) {
  return transitionVisualExpressions(project, clip, clock).x;
}
