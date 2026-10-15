import { performance } from "node:perf_hooks";
import { createProject, defaultTransform, newText } from "../shared/model";
import { createTransformSampler } from "../shared/editor";
import {
  normalizeTransitions,
  pairedTransition,
  transitionRange,
} from "../shared/transitions";

const easings = ["auto", "linear", "spring", "bounce", "exponential"] as const;

function measure(run: (i: number) => number) {
  for (let i = 0; i < 20; i++) run(i);
  const values: number[] = [];
  let checksum = 0;
  for (let i = 0; i < 160; i++) {
    const start = performance.now();
    checksum += run(i);
    values.push(performance.now() - start);
  }
  values.sort((a, b) => a - b);
  return { p95Ms: values[Math.floor(values.length * 0.95)], checksum };
}

export function benchmarkHotpaths() {
  const verification: unknown[] = [];
  const animation = [10, 1000, 10000].map((count) => {
    const clip = newText("video", 0);
    clip.animationOffset = 0.13;
    clip.keyframes = Array.from({ length: count }, (_, i) => ({
      time: i / 100,
      easing: easings[i % easings.length],
      value: {
        ...defaultTransform,
        x: Math.sin(i) * 0.3,
        scale: 1 + (i % 10) / 10,
      },
    })).reverse();
    const start = performance.now();
    const sample = createTransformSampler(clip);
    const prepareMs = performance.now() - start;
    const times = Array.from(
      { length: 160 },
      (_, i) => ((i * 7919) % count) / 100 + 0.0037 - 0.13,
    );
    for (const time of [...times, -1, count / 100 + 1])
      verification.push(sample(time));
    const result = measure((i) => {
      const value = sample(times[i]);
      return value.x + value.scale + value.opacity;
    });
    return { keyframes: count, prepareMs, ...result };
  });
  const transitions = [100, 1000, 2000].map((count) => {
    const project = createProject();
    project.clips = Array.from({ length: count }, (_, i) => {
      const clip = newText("video", i);
      clip.id = `clip${i}`;
      clip.duration = 1;
      const value = (pairId: string) => ({
        type: "smooth-slide" as const,
        duration: 0.6,
        enabled: true,
        reverse: false,
        pairId,
      });
      clip.transitions = {
        ...(i ? { incoming: value(`pair${i - 1}`) } : {}),
        ...(i < count - 1 ? { outgoing: value(`pair${i}`) } : {}),
      };
      return clip;
    });
    const start = performance.now();
    const normalized = normalizeTransitions(project);
    const normalizeMs = performance.now() - start;
    const result = measure((i) => {
      const clip = normalized.clips[(i * 7919) % (count - 1)];
      const pair = pairedTransition(normalized, clip, "outgoing");
      const range = transitionRange(normalized, clip);
      return (pair?.start ?? -1) + range.end;
    });
    verification.push(
      normalized.clips.map((clip) => clip.transitions),
      result.checksum,
    );
    return { clips: count, normalizeMs, ...result };
  });
  return { animation, transitions, verification };
}
