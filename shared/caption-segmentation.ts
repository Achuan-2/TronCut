import { type Clip, type Project, uid } from "./model";
import type { Cue } from "./subtitles";

export interface CaptionSegmentationGroup {
  clips: Clip[];
  cue: Cue;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  return value;
}

const appearance = (clip: Clip) => {
  const {
    id,
    name,
    text,
    start,
    duration,
    sourceIn,
    animationOffset,
    ...rest
  } = clip;
  return JSON.stringify(stableValue(rest));
};
const animated = (clip: Clip) =>
  clip.keyframes.length || clip.behaviors?.length || clip.transitions;
const normalized = (text: string) => text.replace(/\s/gu, "");

/** Rejoin only neighboring compatible cues; never bridge tracks, selections or long pauses.
 * Character times are estimates within each existing cue, not new ASR alignment. */
export function captionSegmentationGroups(
  project: Project,
  ids: string[],
): CaptionSegmentationGroup[] {
  const selected = new Set(ids);
  const groups: CaptionSegmentationGroup[] = [];
  for (const track of project.tracks) {
    if (track.locked) continue;
    let pending: CaptionSegmentationGroup | undefined;
    for (const clip of project.clips
      .filter((clip) => clip.trackId === track.id)
      .sort((a, b) => a.start - b.start)) {
      if (!clip.caption || !selected.has(clip.id) || !clip.text?.trim()) {
        pending = undefined;
        continue;
      }
      const previous = pending?.clips.at(-1);
      const gap = pending ? clip.start - pending.cue.end : Infinity;
      if (
        !pending ||
        !previous ||
        gap < -1e-6 ||
        gap > 0.35 ||
        animated(previous) ||
        animated(clip) ||
        appearance(previous) !== appearance(clip) ||
        clip.start + clip.duration - pending.cue.start > 60 ||
        pending.cue.text.length + clip.text.length > 1000
      ) {
        pending = {
          clips: [],
          cue: {
            start: clip.start,
            end: clip.start + clip.duration,
            text: "",
            words: [],
          },
        };
        groups.push(pending);
      }
      const text = clip.text.trim();
      const separator =
        /[\p{Script=Latin}\d]$/u.test(pending.cue.text) &&
        /^[\p{Script=Latin}\d]/u.test(text)
          ? " "
          : "";
      const chars = Array.from(text);
      pending.cue.words!.push(
        ...chars.map((char, index) => ({
          start: clip.start + (clip.duration * index) / chars.length,
          end: clip.start + (clip.duration * (index + 1)) / chars.length,
          text: (index === 0 ? separator : "") + char,
        })),
      );
      pending.cue.text += separator + text;
      pending.cue.end = clip.start + clip.duration;
      pending.clips.push(clip);
    }
  }
  return groups;
}

/** Apply a whole operation in one history entry, retaining the original visual properties. */
export function applyCaptionSegmentation(
  project: Project,
  results: { group: CaptionSegmentationGroup; cues: Cue[] }[],
): { project: Project; ids: string[]; changed: number } {
  const replacements = new Map<string, Clip[]>();
  let changed = 0;
  const ids: string[] = [];
  for (const { group, cues } of results) {
    if (
      !cues.length ||
      normalized(cues.map((cue) => cue.text).join("")) !==
        normalized(group.cue.text) ||
      cues.some(
        (cue, index) =>
          cue.start < group.cue.start - 1e-6 ||
          cue.end > group.cue.end + 1e-6 ||
          cue.end <= cue.start ||
          (index > 0 && cue.start < cues[index - 1].end - 1e-6),
      )
    )
      throw new Error("断句结果与原字幕不一致，已保留原字幕");
    if (
      group.clips.some((original) => {
        const current = project.clips.find((clip) => clip.id === original.id);
        return (
          !current ||
          JSON.stringify(current) !== JSON.stringify(original) ||
          project.tracks.find((track) => track.id === current.trackId)?.locked
        );
      })
    )
      continue;
    const unchanged =
      cues.length === group.clips.length &&
      cues.every((cue, index) => {
        const original = group.clips[index];
        return (
          cue.text === original.text &&
          Math.abs(cue.start - original.start) < 1e-6 &&
          Math.abs(cue.end - original.start - original.duration) < 1e-6
        );
      });
    if (unchanged) {
      ids.push(...group.clips.map((clip) => clip.id));
      continue;
    }
    const template = group.clips[0];
    const clips = cues.map((cue, index): Clip => ({
      ...template,
      id: group.clips[index]?.id ?? uid(),
      text: cue.text,
      name: cue.text.slice(0, 24) || "空白字幕",
      start: cue.start,
      duration: cue.end - cue.start,
      sourceIn:
        template.sourceIn + (cue.start - template.start) * template.speed,
      ...(template.keyframes.length ||
      template.animationOffset !== undefined ||
      template.behaviors?.length
        ? {
            animationOffset:
              (template.animationOffset ?? 0) + cue.start - template.start,
          }
        : {}),
    }));
    replacements.set(template.id, clips);
    for (const original of group.clips.slice(1))
      replacements.set(original.id, []);
    ids.push(...clips.map((clip) => clip.id));
    changed += group.clips.length;
  }
  return {
    project: changed
      ? {
          ...project,
          clips: project.clips.flatMap(
            (clip) => replacements.get(clip.id) ?? [clip],
          ),
        }
      : project,
    ids,
    changed,
  };
}
