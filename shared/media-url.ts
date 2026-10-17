/** Playback URLs resolve through the main process's registered asset map. */
export function mediaAssetUrl(id: string): string {
  return `framecraft-media://asset/${encodeURIComponent(id)}`;
}
