import type { Asset, Clip } from "../shared/model";
import {
  sourceTimeAt,
  mediaSegments,
  frozenAt,
} from "../shared/media-segments";

export interface PreviewMediaState {
  clip: Clip;
  asset: Asset;
  localTime: number;
  playing: boolean;
  muted: boolean;
  fps?: number;
}

/** One decoder owns its seeks and play requests, including asynchronous loads. */
export function createPreviewMediaController(media: HTMLMediaElement) {
  let state: PreviewMediaState | undefined;
  let previousClip: Clip | undefined;
  let previousSegment = -1;
  let pendingSeek: number | undefined;
  let playPending = false;
  let disposed = false;
  const play = () => {
    if (
      disposed ||
      !state?.playing ||
      frozenAt(state.clip, state.localTime) ||
      !media.paused ||
      playPending
    )
      return;
    playPending = true;
    void media
      .play()
      .catch(() => {
        // A source change or a newer seek can abort play(). loadeddata/canplay
        // and the next clock update retry against the current source.
      })
      .finally(() => {
        playPending = false;
      });
  };
  const synchronize = (force = false) => {
    if (!state || disposed) return;
    const { clip, asset, playing, muted, fps } = state;
    // A free-moving scrub cursor must not decode every subframe pointer step.
    const localTime =
      !playing && fps
        ? Math.round(state.localTime * fps) / fps
        : state.localTime;
    const frozen = frozenAt(clip, localTime);
    if (media.playbackRate !== clip.speed) media.playbackRate = clip.speed;
    if (!media.preservesPitch) media.preservesPitch = true;
    const volume = Math.min(1, Math.max(0, clip.volume));
    if (media.volume !== volume) media.volume = volume;
    const silent = muted || !!clip.audioDetached || frozen;
    if (media.muted !== silent) media.muted = silent;
    const absolute = sourceTimeAt(clip, localTime);
    const target =
      clip.loop && asset.duration > 0 ? absolute % asset.duration : absolute;
    const segment = clip.stitch
      ? mediaSegments(clip).filter((part) => localTime >= part.start).length
      : -1;
    const cut = previousClip?.id !== clip.id || previousSegment !== segment;
    previousClip = clip;
    previousSegment = segment;
    if (
      force ||
      cut ||
      Math.abs(media.currentTime - target) >
        (playing && !frozen ? 0.25 : fps ? 0.001 : 0.025)
    )
      pendingSeek = target;
    // Wait for the previous seek to finish. Reassigning currentTime every
    // render can starve the decoder when it is already behind the playhead.
    if (pendingSeek !== undefined && media.readyState >= 1 && !media.seeking) {
      const next = Math.max(
        0,
        Math.min(
          Number.isFinite(media.duration)
            ? Math.max(0, media.duration - 0.001)
            : pendingSeek,
          pendingSeek,
        ),
      );
      pendingSeek = undefined;
      if (Math.abs(media.currentTime - next) > 0.001) media.currentTime = next;
    }
    if (playing && !frozen) play();
    else if (!media.paused) media.pause();
  };
  const loaded = () => synchronize(true);
  const ready = () => synchronize();
  media.addEventListener("loadedmetadata", loaded);
  media.addEventListener("loadeddata", ready);
  media.addEventListener("canplay", ready);
  media.addEventListener("seeked", ready);
  return {
    update(next: PreviewMediaState) {
      state = next;
      synchronize();
    },
    dispose() {
      disposed = true;
      media.pause();
      media.removeEventListener("loadedmetadata", loaded);
      media.removeEventListener("loadeddata", ready);
      media.removeEventListener("canplay", ready);
      media.removeEventListener("seeked", ready);
    },
  };
}
