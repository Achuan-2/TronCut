// Recordly cursor interpolation, Copyright (C) 2026 webadderall. AGPL-3.0-only.
import type { CursorTelemetryPoint } from "./types";
export function interpolateCursorPosition(samples: CursorTelemetryPoint[], timeMs: number) {
  if (!samples.length) return null;
  if (timeMs <= samples[0].timeMs) return samples[0];
  if (timeMs >= samples[samples.length - 1].timeMs) return samples[samples.length - 1];
  let lo = 0, hi = samples.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].timeMs <= timeMs) lo = mid;
    else hi = mid;
  }
  const a = samples[lo], b = samples[hi], span = b.timeMs - a.timeMs;
  const t = span <= 0 ? 0 : (timeMs - a.timeMs) / span;
  return { cx: a.cx + (b.cx - a.cx) * t, cy: a.cy + (b.cy - a.cy) * t };
}
