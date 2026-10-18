import type { Clip, Project } from "./model";
import { transitionRange } from "./transitions";

/** Stable decoder slots: cuts reuse a decoder; overlaps retain separate ones. */
export function createPreviewMediaPlan(project: Project) {
  const keys = new Map<string, string>();
  const groups = new Map<string, number[]>();
  const media = project.clips
    .filter(
      (clip) =>
        clip.assetId && (clip.kind === "video" || clip.kind === "audio"),
    )
    .map((clip) => ({ clip, ...transitionRange(project, clip) }))
    .sort((a, b) => a.start - b.start || a.clip.id.localeCompare(b.clip.id));
  for (const { clip, start, end } of media) {
    const base = `media:${clip.trackId}:${clip.assetId}`;
    const slots = groups.get(base) ?? [];
    let slot = slots.findIndex((until) => until <= start + 1e-7);
    if (slot < 0) slot = slots.length;
    slots[slot] = end;
    groups.set(base, slots);
    keys.set(clip.id, `${base}:${slot}`);
  }
  return {
    key: (clip: Clip) => keys.get(clip.id) ?? clip.id,
    upcoming(
      time: number,
      occupied: ReadonlySet<string>,
      activeTracks: ReadonlySet<string>,
    ) {
      const result: Clip[] = [];
      const reserved = new Set(occupied);
      let low = 0,
        high = media.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (media[middle].start <= time) low = middle + 1;
        else high = middle;
      }
      // Keep preload work bounded even in projects with many parallel tracks.
      for (let index = low; index < media.length; index++) {
        const { clip, start } = media[index];
        if (start > time + 1.5 || result.length >= 6) break;
        const key = keys.get(clip.id)!;
        if (reserved.has(key) || !activeTracks.has(clip.trackId)) continue;
        reserved.add(key);
        result.push(clip);
      }
      return result;
    },
  };
}
