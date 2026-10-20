import { describe, expect, it } from "vitest";
import {
  createProject,
  newText,
  validateProject,
  type Clip,
  type Project,
} from "../shared/model";
import {
  createClipGroup,
  groupedTimeline,
  groupMembers,
} from "../shared/clip-groups";
import {
  moveTimelineClips,
  moveTimelineGroup,
} from "../shared/timeline-overwrite";
import { hasProjectTimelineOverlap } from "../shared/timeline-collision";
import { sourceTimeAt } from "../shared/media-segments";
import { transformAt } from "../shared/editor";
import { fadeOpacity } from "../shared/effects";

function clip(
  id: string,
  start: number,
  duration: number,
  trackId = "video",
): Clip {
  return {
    ...newText(trackId, start),
    id,
    kind: "video",
    assetId: "source",
    name: id,
    duration,
  };
}
function fixture(clips = [clip("A", 0, 10), clip("B", 12, 3)]): Project {
  return {
    ...createProject(),
    clips,
    assets: [
      {
        id: "source",
        name: "source",
        path: "source.mp4",
        kind: "video",
        duration: 60,
        width: 160,
        height: 90,
        hasAudio: true,
      },
    ],
  };
}
function spans(project: Project, name: string) {
  return project.clips
    .filter((clip) => clip.name === name)
    .sort((a, b) => a.start - b.start)
    .map(({ start, duration }) => [start, duration]);
}
function valid(project: Project) {
  expect(hasProjectTimelineOverlap(project)).toBe(false);
  expect(validateProject(project).clips).toHaveLength(project.clips.length);
}

describe("时间线拖动覆盖", () => {
  it("拖到前一素材尾部时截开原片段并直接衔接新素材", () => {
    const project = fixture([clip("A", 0, 10), clip("B", 12, 6)]);
    const result = moveTimelineClips(project, ["B"], -7);
    expect(spans(result, "A")).toEqual([[0, 5]]);
    expect(spans(result, "B")).toEqual([[5, 6]]);
    expect(spans(project, "A")).toEqual([[0, 10]]);
    valid(result);
  });

  it("中间覆盖只挖除新素材时段，保留右侧源时间和其他轨道", () => {
    const project = fixture();
    project.clips[0] = { ...project.clips[0], sourceIn: 2, speed: 2 };
    const title = newText("titles", 0);
    project.clips.push(title);
    project.markers = [{ id: "marker", time: 9, label: "保留" }];
    const result = moveTimelineClips(project, ["B"], -7);
    expect(spans(result, "A")).toEqual([
      [0, 5],
      [8, 2],
    ]);
    const right = result.clips.find(
      (clip) => clip.name === "A" && clip.start === 8,
    )!;
    expect(right.sourceIn).toBe(18);
    expect(sourceTimeAt(right, 1)).toBe(20);
    expect(result.clips.find((clip) => clip.id === title.id)).toBe(title);
    expect(result.markers).toBe(project.markers);
    valid(result);
  });

  it("覆盖多个片段时删除完全覆盖的片段，并保留两端", () => {
    const project = fixture([
      clip("A", 0, 2),
      clip("C", 2, 2),
      clip("D", 4, 3),
      clip("B", 10, 5),
    ]);
    const result = moveTimelineClips(project, ["B"], -9);
    expect(spans(result, "A")).toEqual([[0, 1]]);
    expect(spans(result, "C")).toEqual([]);
    expect(spans(result, "D")).toEqual([[6, 1]]);
    expect(spans(result, "B")).toEqual([[1, 5]]);
    valid(result);
  });

  it("拖动自身或多选时不裁掉所选素材，同一偏移保留间隔", () => {
    const project = fixture([
      clip("A", 0, 10),
      clip("B", 12, 2),
      clip("C", 16, 2),
    ]);
    const result = moveTimelineClips(project, ["B", "C"], -11);
    expect(spans(result, "A")).toEqual([
      [0, 1],
      [3, 2],
      [7, 3],
    ]);
    expect(spans(result, "B")).toEqual([[1, 2]]);
    expect(spans(result, "C")).toEqual([[5, 2]]);
    const self = moveTimelineClips(fixture([clip("B", 3, 5)]), ["B"], -1);
    expect(self.clips).toHaveLength(1);
    expect(self.clips[0]).toMatchObject({ id: "B", start: 2, duration: 5 });
    valid(result);
  });

  it("跨轨覆盖使用目标轨道，源轨其他片段保持原值", () => {
    const other = clip("C", 0, 10);
    const project = fixture([
      other,
      clip("A", 0, 10, "titles"),
      clip("B", 12, 3),
    ]);
    const result = moveTimelineClips(project, ["B"], -7, "titles");
    expect(spans(result, "A")).toEqual([
      [0, 5],
      [8, 2],
    ]);
    expect(result.clips.find((clip) => clip.id === "B")?.trackId).toBe(
      "titles",
    );
    expect(result.clips.find((clip) => clip.id === "C")).toBe(other);
    valid(result);
  });

  it("锁定源、目标轨道或组内成员时，整步保持原样", () => {
    const project = fixture();
    project.tracks.find((track) => track.id === "video")!.locked = true;
    expect(moveTimelineClips(project, ["B"], -7)).toBe(project);
    const cross = fixture([clip("A", 0, 10, "titles"), clip("B", 12, 3)]);
    cross.tracks.find((track) => track.id === "titles")!.locked = true;
    expect(moveTimelineClips(cross, ["B"], -7, "titles")).toBe(cross);
    const grouped = createClipGroup(
      fixture([
        clip("A", 0, 10, "titles"),
        clip("C", 0, 10, "audio"),
        clip("B", 12, 3),
      ]),
      new Set(["A", "C"]),
    );
    grouped.tracks.find((track) => track.id === "audio")!.locked = true;
    expect(moveTimelineClips(grouped, ["B"], -7, "titles")).toBe(grouped);
  });

  it("首尾相接和零移动不裁分，负时间统一限制到零", () => {
    const project = fixture();
    expect(moveTimelineClips(project, ["B"], 0)).toBe(project);
    expect(moveTimelineClips(project, ["B"], NaN)).toBe(project);
    const touching = moveTimelineClips(project, ["B"], -2);
    expect(touching.clips).toHaveLength(2);
    expect(touching.clips[0]).toBe(project.clips[0]);
    const clamped = moveTimelineClips(project, ["B"], -30);
    expect(spans(clamped, "B")).toEqual([[0, 3]]);
    expect(spans(clamped, "A")).toEqual([[3, 7]]);
    valid(clamped);
  });

  it("保留精确落点，避免次帧取整留下重叠", () => {
    const project = fixture();
    const result = moveTimelineClips(project, ["B"], -6.987);
    const moving = result.clips.find((clip) => clip.id === "B")!;
    const left = result.clips.find((clip) => clip.id === "A")!;
    const right = result.clips.find(
      (clip) => clip.name === "A" && clip.id !== "A",
    )!;
    expect(left.start + left.duration).toBeCloseTo(moving.start, 10);
    expect(right.start).toBeCloseTo(moving.start + moving.duration, 10);
    valid(result);
  });

  it("裁分保留动画、淡入淡出、变速、拼接与帧定格的源时钟", () => {
    const project = fixture();
    const original = (project.clips[0] = {
      ...project.clips[0],
      speed: 2,
      sourceIn: 0,
      stitch: [
        { sourceIn: 2, duration: 6 },
        { sourceIn: 8, duration: 4, freeze: true },
        { sourceIn: 12, duration: 10 },
      ],
      fadeIn: 2,
      fadeOut: 3,
      keyframes: [
        { time: 0, value: { ...project.clips[0].transform, x: 0.1 } },
        { time: 10, value: { ...project.clips[0].transform, x: 0.9 } },
      ],
    });
    const result = moveTimelineClips(project, ["B"], -7);
    const pieces = result.clips.filter((clip) => clip.name === "A");
    for (const piece of pieces)
      for (const local of [0, piece.duration / 2, piece.duration - 0.01]) {
        const oldLocal = piece.start + local;
        expect(sourceTimeAt(piece, local)).toBeCloseTo(
          sourceTimeAt(original, oldLocal),
        );
        expect(transformAt(piece, local)).toEqual(
          transformAt(original, oldLocal),
        );
        expect(fadeOpacity(piece, local)).toBeCloseTo(
          fadeOpacity(original, oldLocal),
        );
      }
    valid(result);
  });

  it("覆盖组合时同步裁分全部成员，并将左右两段保留为独立组合", () => {
    const project = createClipGroup(
      fixture([clip("A", 0, 10, "titles"), clip("C", 0, 10), clip("B", 12, 3)]),
      new Set(["A", "C"]),
    );
    const result = moveTimelineClips(project, ["B"], -7, "titles");
    expect(spans(result, "A")).toEqual([
      [0, 5],
      [8, 2],
    ]);
    expect(spans(result, "C")).toEqual([
      [0, 5],
      [8, 2],
    ]);
    expect(groupedTimeline(result).groups.size).toBe(2);
    expect(
      new Set(
        result.clips
          .filter((clip) => clip.name === "A")
          .map((clip) => clip.groupId),
      ).size,
    ).toBe(2);
    valid(result);
  });

  it("拖动折叠组合时整组覆盖并保留层次，支持换轨", () => {
    const project = createClipGroup(
      fixture([
        clip("A", 0, 10, "titles"),
        clip("B", 12, 3, "video"),
        clip("C", 12, 3, "audio"),
      ]),
      new Set(["B", "C"]),
    );
    const id = project.clips.find((clip) => clip.id === "B")!.groupId!;
    const result = moveTimelineGroup(project, id, -7, "titles");
    expect(spans(result, "A")).toEqual([
      [0, 5],
      [8, 2],
    ]);
    expect(
      groupMembers(result, id).map((clip) => [
        clip.id,
        clip.trackId,
        clip.start,
      ]),
    ).toEqual([
      ["B", "titles", 5],
      ["C", "video", 5],
    ]);
    valid(result);
  });
});
