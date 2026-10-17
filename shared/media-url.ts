/** Playback URLs resolve through the main process's registered asset map. */
export function mediaAssetUrl(
  id: string,
  preview = false,
  revision = 0,
): string {
  const query = preview ? `?preview=1&revision=${revision}` : "";
  return `framecraft-media://asset/${encodeURIComponent(id)}${query}`;
}
