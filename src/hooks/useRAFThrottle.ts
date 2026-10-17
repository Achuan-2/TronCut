import { useCallback, useRef, useEffect } from 'react';

/**
 * Custom hook for throttling updates with requestAnimationFrame.
 * Batches multiple rapid calls into a single frame update for optimal performance.
 *
 * @template T - The type of data being throttled
 * @param callback - Function to call with the throttled value
 * @returns A function to schedule updates
 */
export function useRAFThrottle<T>(callback: (value: T) => void) {
  const rafRef = useRef<number | null>(null);
  const pendingValue = useRef<T | undefined>(undefined);
  const hasPending = useRef(false);
  const callbackRef = useRef(callback);

  // Keep callback reference up to date
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const flush = useCallback(() => {
    if (hasPending.current) {
      callbackRef.current(pendingValue.current as T);
      hasPending.current = false;
      pendingValue.current = undefined;
    }
  }, []);

  const scheduleUpdate = useCallback((value: T) => {
    if (value === null) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      hasPending.current = false;
      pendingValue.current = undefined;
      callbackRef.current(value);
      return;
    }

    pendingValue.current = value;
    hasPending.current = true;
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        flush();
      });
    }
  }, [flush]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  return scheduleUpdate;
}

/**
 * Custom hook for throttling scroll events with requestAnimationFrame.
 * Optimized for scroll handlers to prevent excessive re-renders.
 */
export function useRAFScrollThrottle(callback: () => void) {
  const rafRef = useRef<number | null>(null);
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const scheduleUpdate = useCallback(() => {
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        callbackRef.current();
        rafRef.current = null;
      });
    }
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  return scheduleUpdate;
}
