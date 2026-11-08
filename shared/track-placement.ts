import type { Project } from "./model";

/** New media layers go below all caption tracks without moving existing layers. */
export function mediaTrackInsertionIndex(tracks: Project["tracks"]): number {
  for (let index = tracks.length - 1; index >= 0; index--) {
    if (tracks[index].captionTrack) return index + 1;
  }
  return 0;
}
