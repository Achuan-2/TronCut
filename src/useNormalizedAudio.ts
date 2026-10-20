import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { Asset, Project } from "../shared/model";
import { normalizationKey, normalizesClip } from "../shared/loudness";
import { isTrackActive } from "../shared/tracks";

interface Entry {
  result?: Asset;
  error?: string;
  pending: boolean;
}
const cache = new WeakMap<Asset, Map<boolean, Entry>>();
const listeners = new Set<() => void>();
let revision = 0;
const snapshot = () => revision;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const notify = () => {
  revision++;
  listeners.forEach((listener) => listener());
};

function load(asset: Asset, podcast: boolean) {
  let variants = cache.get(asset);
  if (!variants) {
    variants = new Map();
    cache.set(asset, variants);
  }
  if (variants.get(podcast)?.pending || variants.get(podcast)?.result) return;
  const entry: Entry = { pending: true };
  variants.set(podcast, entry);
  notify();
  void (
    window.framecraft?.normalizeAudio(asset.id, podcast) ??
    Promise.reject(new Error("响度标准化需要桌面版"))
  )
    .then((result) => {
      entry.result = result;
    })
    .catch((error) => {
      entry.error = String(error);
    })
    .finally(() => {
      entry.pending = false;
      notify();
    });
}

/** Prepares each source once, before allowing normalized project playback. */
export function useNormalizedAudio(project: Project) {
  const version = useSyncExternalStore(subscribe, snapshot, snapshot);
  const requests = useMemo(() => {
    const sources = new Map(project.assets.map((asset) => [asset.id, asset]));
    const tracks = new Map(project.tracks.map((track) => [track.id, track]));
    const needed = new Map<string, { asset: Asset; podcast: boolean }>();
    for (const clip of project.clips) {
      const asset = sources.get(clip.assetId ?? "");
      const track = tracks.get(clip.trackId);
      if (
        normalizesClip(project, clip) &&
        asset?.hasAudio &&
        !asset.missing &&
        track &&
        !track.muted &&
        isTrackActive(project.tracks, track.id) &&
        clip.volume > 0
      )
        needed.set(normalizationKey(clip), { asset, podcast: clip.podcast });
    }
    return needed;
  }, [
    project.assets,
    project.clips,
    project.tracks,
    project.audio?.autoNormalizeLoudness,
  ]);
  useEffect(() => {
    requests.forEach(({ asset, podcast }) => load(asset, podcast));
  }, [requests]);
  return useMemo(() => {
    const assets = new Map<string, Asset>();
    let pending = false,
      error: string | undefined;
    requests.forEach(({ asset, podcast }, key) => {
      const entry = cache.get(asset)?.get(podcast);
      if (entry?.result) assets.set(key, entry.result);
      else if (entry?.error) error ??= entry.error;
      else pending = true;
    });
    return {
      assets,
      pending,
      error,
      retry: () =>
        requests.forEach(({ asset, podcast }) => load(asset, podcast)),
    };
  }, [requests, version]);
}
