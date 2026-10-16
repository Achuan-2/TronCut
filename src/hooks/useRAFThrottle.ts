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
  const rafRef = useRef<number>();
  const pendingValue = useRef<T | null>(null);
  const callbackRef = useRef(callback);

  // Keep callback reference up to date
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const flush = useCallback(() => {
    if (pendingValue.current !== null) {
      callbackRef.current(pendingValue.current);
      pendingValue.current = null;
    }
  }, []);

  const scheduleUpdate = useCallback((value: T) => {
    pendingValue.current = value;
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        flush();
        rafRef.current = undefined;
      });
    }
  }, [flush]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) {
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
  const rafRef = useRef<number>();
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const scheduleUpdate = useCallback(() => {
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        callbackRef.current();
        rafRef.current = undefined;
      });
    }
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  return scheduleUpdate;
}
