import type { SetStateAction } from "react";

export interface PlaybackStore {
  getSnapshot(): number;
  getServerSnapshot(): number;
  subscribe(listener: () => void): () => void;
  set(next: SetStateAction<number>): number;
}

export function createPlaybackStore(initial: number): PlaybackStore {
  let value = initial;
  const listeners = new Set<() => void>();
  const getSnapshot = () => value;
  return {
    getSnapshot,
    getServerSnapshot: getSnapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      const resolved =
        typeof next === "function" ? next(value) : next;
      if (Object.is(resolved, value)) return value;
      value = resolved;
      listeners.forEach((listener) => listener());
      return value;
    },
  };
}
