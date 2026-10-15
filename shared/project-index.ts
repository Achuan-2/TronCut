import type { Clip, Project } from "./model";
import { RustTimelineIndex } from "./rust-engine";
import { transitionRange } from "./transitions";

class ProjectIndex {
  readonly timeline = new RustTimelineIndex();
  private preview = this.timeline;
  private hasPairedTransitions = false;
  private readonly tracks = new Map<string, number>();
  private readonly positions = new Map<string, number>();
  readonly clipsById: Map<string, Clip>;

  constructor(readonly clips: Clip[]) {
    this.clipsById = new Map(clips.map((clip) => [clip.id, clip]));
    clips.forEach((clip, id) => {
      this.hasPairedTransitions ||= !!(
        (clip.transitions?.incoming?.enabled &&
          clip.transitions.incoming.pairId) ||
        (clip.transitions?.outgoing?.enabled &&
          clip.transitions.outgoing.pairId)
      );
      this.positions.set(clip.id, id);
      if (!this.tracks.has(clip.trackId))
        this.tracks.set(clip.trackId, this.tracks.size);
      this.timeline.add(
        id,
        this.tracks.get(clip.trackId)!,
        clip.start,
        clip.start + clip.duration,
      );
    });
    this.timeline.build();
  }

  visible(
    trackId: string,
    start: number,
    end: number,
    pinned: readonly string[] = [],
  ): Clip[] {
    const track = this.tracks.get(trackId);
    if (track === undefined) return [];
    const ids = this.timeline.query(start, end, track, true);
    if (pinned.length) {
      const indices = new Set(ids);
      // A dragged clip remains mounted after leaving the viewport.
      for (const id of pinned) {
        if (this.clipsById.get(id)?.trackId === trackId)
          indices.add(this.positions.get(id)!);
      }
      return [...indices].sort((a, b) => a - b).map((id) => this.clips[id]);
    }
    return ids.map((id) => this.clips[id]);
  }

  active(
    project: Project,
    time: number,
    endpointClipId?: string,
    renderClips: Clip[] = this.clips,
  ): Clip[] {
    // Zoom/pan drafts only replace visual properties, preserving clip order and
    // timing. Resolve those drafts after querying the unchanged source index.
    if (this.hasPairedTransitions && this.preview === this.timeline) {
      this.preview = new RustTimelineIndex();
      this.clips.forEach((clip, id) => {
        const range = transitionRange(project, clip);
        this.preview!.add(
          id,
          this.tracks.get(clip.trackId)!,
          range.start,
          range.end,
        );
      });
      this.preview.build();
    }
    const ids = this.preview.query(time);
    const endpoint = endpointClipId && this.clipsById.get(endpointClipId);
    if (
      endpoint &&
      time >= transitionRange(project, endpoint).start &&
      Math.abs(time - endpoint.start - endpoint.duration) < 1e-6
    ) {
      const id = this.positions.get(endpoint.id)!;
      if (!ids.includes(id)) {
        ids.push(id);
        ids.sort((a, b) => a - b);
      }
    }
    return ids.map((id) => renderClips[id]);
  }

  dispose() {
    this.timeline.dispose();
    if (this.preview !== this.timeline) this.preview.dispose();
  }
}

// Bound native memory independently of undo history and JS garbage collection.
const cache: ProjectIndex[] = [];
export function projectIndex(project: Pick<Project, "clips">): ProjectIndex {
  const found = cache.findIndex((index) => index.clips === project.clips);
  if (found >= 0) {
    const [index] = cache.splice(found, 1);
    cache.unshift(index);
    return index;
  }
  const index = new ProjectIndex(project.clips);
  cache.unshift(index);
  while (cache.length > 2) cache.pop()!.dispose();
  return index;
}
