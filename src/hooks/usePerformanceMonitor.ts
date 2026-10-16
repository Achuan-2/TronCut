import { useEffect, useRef } from "react";

interface PerformanceMetrics {
  renderTime: number;
  renderCount: number;
  lastRenderTime: number;
}

/**
 * Performance monitoring hook for measuring component render times
 * Usage: const metrics = usePerformanceMonitor("ComponentName");
 */
export function usePerformanceMonitor(componentName: string): PerformanceMetrics {
  const metrics = useRef<PerformanceMetrics>({
    renderTime: 0,
    renderCount: 0,
    lastRenderTime: 0,
  });
  const renderStart = useRef<number>(0);

  // Mark render start
  renderStart.current = performance.now();

  useEffect(() => {
    // Measure render time after DOM update
    const renderEnd = performance.now();
    const duration = renderEnd - renderStart.current;

    metrics.current.renderCount++;
    metrics.current.lastRenderTime = duration;
    metrics.current.renderTime += duration;

    // Log slow renders (> 16ms for 60fps)
    if (duration > 16 && process.env.NODE_ENV === "development") {
      console.warn(
        `[Performance] ${componentName} slow render: ${duration.toFixed(2)}ms ` +
        `(total: ${metrics.current.renderTime.toFixed(2)}ms, ` +
        `count: ${metrics.current.renderCount})`
      );
    }
  });

  return metrics.current;
}

/**
 * Measure execution time of an async operation
 */
export async function measureAsync<T>(
  label: string,
  fn: () => Promise<T>
): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    const duration = performance.now() - start;
    if (process.env.NODE_ENV === "development") {
      console.log(`[Performance] ${label}: ${duration.toFixed(2)}ms`);
    }
    return result;
  } catch (error) {
    const duration = performance.now() - start;
    if (process.env.NODE_ENV === "development") {
      console.error(
        `[Performance] ${label} failed after ${duration.toFixed(2)}ms`,
        error
      );
    }
    throw error;
  }
}

/**
 * Measure execution time of a sync operation
 */
export function measureSync<T>(label: string, fn: () => T): T {
  const start = performance.now();
  try {
    const result = fn();
    const duration = performance.now() - start;
    if (process.env.NODE_ENV === "development") {
      console.log(`[Performance] ${label}: ${duration.toFixed(2)}ms`);
    }
    return result;
  } catch (error) {
    const duration = performance.now() - start;
    if (process.env.NODE_ENV === "development") {
      console.error(
        `[Performance] ${label} failed after ${duration.toFixed(2)}ms`,
        error
      );
    }
    throw error;
  }
}
