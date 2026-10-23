import type { Clip, Project } from "./model";
import {
  hasClipSpeed,
  removeClipSpeed,
  setClipSpeed,
  supportsClipSpeed,
} from "./clip-speed";
import { supportsMediaFrame } from "./media-frame";
import {
  rangedVisualEffect,
  type RangedVisualEffectId,
} from "./visual-effect-range";
import type { VisualEffectId } from "./visual-effect-drag";
import type { VisualEffects } from "./visual-effects";
import { effectWindow } from "./effect-timing";
import { clearMaskChannels, maskClipAt } from "./mask-state";
import { transformAt } from "./editor";
import { editableIds } from "./timeline";

export type TimelineEffectSelection = { clipId: string; id: VisualEffectId };
export type CopiedTimelineEffect =
  | { id: "clip-speed"; speed: number }
  | {
      id: RangedVisualEffectId;
      effect: NonNullable<ReturnType<typeof rangedVisualEffect>>;
      duration: number;
    };

export function hasTimelineEffect(clip: Clip, id: VisualEffectId) {
  return id === "clip-speed"
    ? hasClipSpeed(clip)
    : !!rangedVisualEffect(clip, id);
}

/** Copy the visible mask pose, without copying the object's motion channels. */
export function copyTimelineEffect(
  clip: Clip,
  id: VisualEffectId,
  localTime = 0,
): CopiedTimelineEffect | null {
  if (id === "clip-speed")
    return hasClipSpeed(clip) ? { id, speed: clip.speed } : null;
  const source =
    id === "mask" ? maskClipAt(clip, transformAt(clip, localTime)) : clip;
  const settings = rangedVisualEffect(source, id);
  if (!settings) return null;
  const { timing: _timing, ...effect } = structuredClone(settings);
  if (settings.window) {
    effect.window = effectWindow(settings, clip.duration);
    if (effect.window.end <= effect.window.start) return null;
  }
  return { id, effect, duration: clip.duration };
}

export function removeTimelineEffect(clip: Clip, id: VisualEffectId): Clip {
  if (!hasTimelineEffect(clip, id)) return clip;
  if (id === "clip-speed") return removeClipSpeed(clip);
  if (id === "rounded-corners") {
    const { mediaFrame: _frame, ...rest } = clip;
    return rest;
  }
  const source = id === "mask" ? clearMaskChannels(clip) : clip;
  const effects = { ...source.visualEffects };
  delete effects[id];
  return {
    ...source,
    visualEffects: Object.keys(effects).length ? effects : undefined,
  };
}

export function canPasteTimelineEffect(
  clip: Clip,
  copied: CopiedTimelineEffect,
) {
  if (copied.id === "clip-speed") return supportsClipSpeed(clip);
  if (copied.id === "rounded-corners") return supportsMediaFrame(clip);
  return clip.kind !== "audio";
}

/** Replace only the same effect. Its local range scales to the target clip. */
export function pasteTimelineEffect(
  clip: Clip,
  copied: CopiedTimelineEffect,
): Clip {
  if (!canPasteTimelineEffect(clip, copied)) return clip;
  if (copied.id === "clip-speed") return setClipSpeed(clip, copied.speed);
  const effect = structuredClone(copied.effect);
  const ratio = clip.duration / copied.duration;
  if (effect.window)
    effect.window = {
      start: effect.window.start * ratio,
      end: effect.window.end * ratio,
    };
  if ("easeIn" in effect)
    effect.easeIn = Math.min(86400, effect.easeIn * ratio);
  if ("easeOut" in effect)
    effect.easeOut = Math.min(86400, effect.easeOut * ratio);
  if (copied.id === "rounded-corners")
    return { ...clip, mediaFrame: effect as Clip["mediaFrame"] };
  const source = copied.id === "mask" ? clearMaskChannels(clip) : clip;
  return {
    ...source,
    visualEffects: {
      ...source.visualEffects,
      [copied.id]: effect,
    } as VisualEffects,
  };
}

export function pasteTimelineEffects(
  project: Project,
  ids: readonly string[],
  copied: CopiedTimelineEffect,
): Project {
  const editable = editableIds(project, ids);
  if (!ids.length || ids.some((id) => !editable.has(id))) return project;
  const clips = project.clips.map((clip) =>
    editable.has(clip.id) ? pasteTimelineEffect(clip, copied) : clip,
  );
  return clips.some((clip, index) => clip !== project.clips[index])
    ? { ...project, clips }
    : project;
}
