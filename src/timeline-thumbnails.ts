import type { Asset } from "../shared/model";

type Listener = (url: string | null) => void;
interface Request {
  key: string;
  revision: number;
  asset: Asset;
  time: number;
  listeners: Set<Listener>;
  running: boolean;
}
interface CachedFrame {
  revision: number;
  time: number;
  url: string;
}

/** Drop obsolete queued work before it reaches IPC; at most two decoders are requested. */
export class TimelineThumbnailLoader {
  private readonly revisions = new WeakMap<Asset, number>();
  private revision = 0;
  private readonly requests = new Map<string, Request>();
  private readonly cache = new Map<string, CachedFrame>();
  private bytes = 0;
  private active = 0;

  constructor(
    private readonly decode: (
      asset: Asset,
      time: number,
    ) => Promise<string | null>,
  ) {}

  private assetRevision(asset: Asset) {
    if (!this.revisions.has(asset)) this.revisions.set(asset, ++this.revision);
    return this.revisions.get(asset)!;
  }

  /** Show an already decoded frame while a finer grid sample is loading. */
  cached(asset: Asset, time: number, sourceStart = time, sourceEnd = time) {
    const revision = this.assetRevision(asset);
    let key = `${revision}:${time}`;
    let frame = this.cache.get(key);
    if (!frame && sourceEnd > sourceStart) {
      let distance = Infinity;
      for (const [candidateKey, candidate] of this.cache) {
        if (
          candidate.revision !== revision ||
          candidate.time < sourceStart ||
          candidate.time >= sourceEnd
        )
          continue;
        const nextDistance = Math.abs(candidate.time - time);
        if (nextDistance < distance) {
          key = candidateKey;
          frame = candidate;
          distance = nextDistance;
        }
      }
    }
    if (!frame) return null;
    this.cache.delete(key);
    this.cache.set(key, frame);
    return frame.url;
  }

  subscribe(asset: Asset, time: number, listener: Listener) {
    const revision = this.assetRevision(asset);
    const key = `${revision}:${time}`;
    const cached = this.cached(asset, time);
    if (cached) {
      listener(cached);
      return () => {};
    }
    let request = this.requests.get(key);
    if (!request) {
      request = {
        key,
        revision,
        asset,
        time,
        listeners: new Set(),
        running: false,
      };
      this.requests.set(key, request);
    }
    request.listeners.add(listener);
    this.pump();
    const entry = request;
    return () => {
      entry.listeners.delete(listener);
      if (!entry.running && !entry.listeners.size) this.requests.delete(key);
    };
  }

  private pump() {
    for (const request of this.requests.values()) {
      if (this.active >= 2) break;
      if (request.running || !request.listeners.size) continue;
      request.running = true;
      this.active++;
      void this.decode(request.asset, request.time)
        .catch(() => null)
        .then((url) => {
          if (url && url.length * 2 <= 16 * 1024 * 1024) {
            this.cache.set(request.key, {
              revision: request.revision,
              time: request.time,
              url,
            });
            this.bytes += url.length * 2;
            while (this.bytes > 16 * 1024 * 1024 || this.cache.size > 384) {
              const oldest = this.cache.keys().next().value!;
              this.bytes -= this.cache.get(oldest)!.url.length * 2;
              this.cache.delete(oldest);
            }
          }
          for (const listener of request.listeners) listener(url);
        })
        .finally(() => {
          this.requests.delete(request.key);
          this.active--;
          this.pump();
        });
    }
  }
}

export const timelineThumbnails = new TimelineThumbnailLoader(
  (asset, time) =>
    window.framecraft?.mediaTimelineThumbnail(asset.id, time) ??
    Promise.resolve(null),
);
