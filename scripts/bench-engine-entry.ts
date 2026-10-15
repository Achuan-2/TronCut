import { performance } from "node:perf_hooks";
import os from "node:os";
import assert from "node:assert/strict";
import { createProject, newText } from "../shared/model";
import { projectIndex } from "../shared/project-index";
import { transitionRange } from "../shared/transitions";

function measure(query: (time: number) => number, times: number[]) {
  for (const time of times.slice(0, 30)) query(time);
  const samples: number[] = [];
  let checksum = 0;
  for (const time of times) {
    const start = performance.now();
    checksum += query(time);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return {
    p50: samples[Math.floor(samples.length * 0.5)],
    p95: samples[Math.floor(samples.length * 0.95)],
    checksum,
  };
}
const round = (value: number) => Number(value.toFixed(4));

export function benchmarkEngine() {
  const cases = [100, 1000, 10000, 100000].map((count) => {
    const project = createProject();
    const prototype = newText("track0", 0);
    project.tracks = Array.from({ length: 32 }, (_, i) => ({
      id: `track${i}`,
      name: `轨道${i}`,
      hidden: false,
      muted: false,
      locked: false,
    }));
    project.clips = Array.from({ length: count }, (_, i) => ({
      ...prototype,
      id: `clip${i}`,
      trackId: `track${i % 32}`,
      start: Math.floor(i / 32) * 6,
      duration: 5,
    }));
    const start = performance.now();
    const index = projectIndex(project);
    index.active(project, 0); // Include the lazy preview index in construction cost.
    const buildMs = performance.now() - start;
    const times = Array.from(
      { length: 160 },
      (_, i) => ((i * 7919) % Math.ceil(count / 32)) * 6 + 2,
    );
    const oldActive = measure(
      (time) =>
        project.clips.filter((clip) => {
          const range = transitionRange(project, clip);
          return time >= range.start && time < range.end;
        }).length,
      times,
    );
    const rustActive = measure(
      (time) => index.active(project, time).length,
      times,
    );
    const oldViewport = measure(
      (time) =>
        project.tracks.reduce(
          (sum, track) =>
            sum +
            project.clips.filter(
              (clip) =>
                clip.trackId === track.id &&
                clip.start + clip.duration >= time - 2 &&
                clip.start <= time + 20,
            ).length,
          0,
        ),
      times,
    );
    const rustViewport = measure(
      (time) =>
        project.tracks.reduce(
          (sum, track) =>
            sum + index.visible(track.id, time - 2, time + 20).length,
          0,
        ),
      times,
    );
    assert.equal(rustActive.checksum, oldActive.checksum);
    assert.equal(rustViewport.checksum, oldViewport.checksum);
    return {
      clips: count,
      buildMs: round(buildMs),
      oldActiveP95Ms: round(oldActive.p95),
      rustActiveP95Ms: round(rustActive.p95),
      activeSpeedup: round(oldActive.p95 / rustActive.p95),
      oldViewportP95Ms: round(oldViewport.p95),
      rustViewportP95Ms: round(rustViewport.p95),
      viewportSpeedup: round(oldViewport.p95 / rustViewport.p95),
    };
  });
  return {
    recordedAt: new Date().toISOString(),
    cpu: os.cpus()[0]?.model,
    platform: process.platform,
    node: process.version,
    tracks: 32,
    queriesPerCase: 160,
    cases,
    limits:
      "Synthetic timeline queries only; not decode, UI frame rate, seeking latency, memory pressure or export throughput.",
  };
}
