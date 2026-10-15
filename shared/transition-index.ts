import type { Clip, Project } from "./model";
import { RustTimelineIndex } from "./rust-engine";
import type { TransitionSide } from "./transitions";

const epsilon = 1e-6;
const sides: readonly TransitionSide[] = ["incoming", "outgoing"];
type Member = { clip: Clip; side: TransitionSide };

class TransitionIndex {
  readonly edges = new RustTimelineIndex();
  readonly pairs = new Map<string, Member[]>();
  private readonly tracks = new Map<string, number>();

  constructor(readonly clips: Clip[]) {
    clips.forEach((clip, id) => {
      for (const side of sides) {
        const pairId = clip.transitions?.[side]?.pairId;
        if (pairId) {
          const members = this.pairs.get(pairId) ?? [];
          members.push({ clip, side });
          this.pairs.set(pairId, members);
        }
      }
      if (clip.kind === "audio") return;
      if (!this.tracks.has(clip.trackId))
        this.tracks.set(clip.trackId, this.tracks.size);
      const track = this.tracks.get(clip.trackId)! * 2;
      const end = clip.start + clip.duration;
      this.edges.add(id, track, clip.start - epsilon, clip.start + epsilon);
      this.edges.add(id, track + 1, end - epsilon, end + epsilon);
    });
    this.edges.build();
  }

  adjacent(clip: Clip, side: TransitionSide): Clip | undefined {
    const track = this.tracks.get(clip.trackId);
    if (track === undefined) return undefined;
    const incoming = side === "incoming";
    const cut = incoming ? clip.start : clip.start + clip.duration;
    const ids = this.edges.query(cut, cut, track * 2 + Number(incoming), true);
    // Query results are in original clip order. Keep the exact legacy strict
    // tolerance, including ambiguous overlaps and floating-point endpoints.
    for (const id of ids) {
      const other = this.clips[id];
      if (
        other.id !== clip.id &&
        Math.abs(
          incoming ? other.start + other.duration - cut : cut - other.start,
        ) < epsilon
      )
        return other;
    }
  }
}

const cache: TransitionIndex[] = [];
export function transitionIndex(
  project: Pick<Project, "clips">,
): TransitionIndex {
  const found = cache.findIndex((index) => index.clips === project.clips);
  if (found >= 0) {
    const [index] = cache.splice(found, 1);
    cache.unshift(index);
    return index;
  }
  const index = new TransitionIndex(project.clips);
  cache.unshift(index);
  while (cache.length > 2) cache.pop()!.edges.dispose();
  return index;
}

/** Normalization is also used after legacy callers mutate a clip array. */
export function invalidateTransitionIndex(project: Pick<Project, "clips">) {
  const found = cache.findIndex((index) => index.clips === project.clips);
  if (found >= 0) cache.splice(found, 1)[0].edges.dispose();
}
