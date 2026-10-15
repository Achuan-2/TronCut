import { expect, it } from "vitest";
import { createProject, newText } from "../shared/model";
import {
  adjacentClip,
  normalizeTransitions,
  pairedTransition,
  type TransitionSide,
} from "../shared/transitions";

it("Rust 接点查询保留严格容差、轨道、音频排除和原始数组顺序", () => {
  const project = createProject();
  project.clips = Array.from({ length: 300 }, (_, i) => ({
    ...newText(`track${i % 4}`, 0),
    id: `clip${i}`,
    start: Math.floor(i / 4) + ((i % 3) - 1) * 0.0000004,
    duration: 1,
    kind: i % 11 === 0 ? ("audio" as const) : ("text" as const),
  }));
  for (const clip of project.clips)
    for (const side of ["incoming", "outgoing"] as const) {
      const expected = project.clips.find(
        (other) =>
          other.id !== clip.id &&
          other.trackId === clip.trackId &&
          other.kind !== "audio" &&
          Math.abs(
            side === "incoming"
              ? other.start + other.duration - clip.start
              : clip.start + clip.duration - other.start,
          ) < 1e-6,
      );
      expect(adjacentClip(project, clip, side)).toBe(expected);
    }
});

it("配对成员为三个、跨轨道或相邻关系被修改后不会成为有效转场", () => {
  const project = createProject();
  project.clips = [
    newText("video", 0),
    newText("video", 5),
    newText("audio", 5),
  ];
  const transition = {
    type: "smooth-slide" as const,
    duration: 1,
    enabled: true,
    reverse: false,
    pairId: "pair",
  };
  project.clips = project.clips.map((clip, i) => ({
    ...clip,
    transitions: i === 0 ? { outgoing: transition } : { incoming: transition },
  }));
  expect(
    pairedTransition(project, project.clips[0], "outgoing"),
  ).toBeUndefined();
  project.clips = project.clips.slice(0, 2);
  expect(pairedTransition(project, project.clips[0], "outgoing")).toBe(
    project.clips[1],
  );
  project.clips[1] = { ...project.clips[1], start: 6 };
  const normalized = normalizeTransitions(project);
  expect(normalized.clips[0].transitions?.outgoing?.pairId).toBeUndefined();
  expect(normalized.clips[1].transitions?.incoming?.pairId).toBeUndefined();
});

it("撤销与索引淘汰后重建，多个相同接点仍选择最先出现的片段", () => {
  const project = createProject();
  project.clips = [
    newText("video", 5),
    newText("video", 5),
    newText("video", 0),
  ];
  expect(adjacentClip(project, project.clips[2], "outgoing")).toBe(
    project.clips[0],
  );
  for (let i = 0; i < 8; i++) {
    const changed = {
      ...project,
      clips: project.clips.map((clip) => ({
        ...clip,
        start: clip.start + i * 10,
      })),
    };
    expect(adjacentClip(changed, changed.clips[2], "outgoing")).toBe(
      changed.clips[0],
    );
  }
  expect(adjacentClip(project, project.clips[2], "outgoing")).toBe(
    project.clips[0],
  );
});
