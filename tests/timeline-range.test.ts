import { describe, expect, it } from "vitest";
import {
  createProject,
  newText,
  validateProject,
  type Clip,
} from "../shared/model";
import {
  deleteTimelineRange,
  normalizeTimelineRange,
} from "../shared/timeline-range";
import { transformAt } from "../shared/editor";
import { fadeOpacity } from "../shared/effects";
import { mediaSegments, sourceTimeAt } from "../shared/media-segments";
import { unstitchClips } from "../shared/stitch";

function fixture() {
  const project = createProject();
  project.assets = [
    {
      id: "source",
      path: "video.mp4",
      name: "视频",
      kind: "video",
      duration: 40,
      width: 320,
      height: 180,
      hasAudio: true,
    },
  ];
  const video: Clip = {
    ...newText("video", 1),
    kind: "video",
    assetId: "source",
    duration: 8,
    sourceIn: 2,
    speed: 2,
    fadeIn: 1,
    fadeOut: 2,
    keyframes: [
      { time: 0, value: { x: 0.1, y: 0.5, scale: 1, opacity: 1 } },
      { time: 8, value: { x: 0.9, y: 0.5, scale: 1, opacity: 1 } },
    ],
  };
  const title = { ...newText("titles", 0), duration: 10 };
  project.clips = [video, title, { ...newText("audio", 12), duration: 1 }];
  project.markers = [
    { id: "m", time: 4, duration: 4, label: "区域" },
    { id: "n", time: 11, label: "后续" },
  ];
  return { project, video, title };
}
describe("时间范围删除", () => {
  it("端点按帧取整，零长度和非法范围不产生编辑", () => {
    expect(normalizeTimelineRange(2.014, 1.01, 30)).toEqual({
      start: 1,
      end: 2,
    });
    expect(normalizeTimelineRange(1, 1.001, 30)).toBeNull();
    expect(normalizeTimelineRange(NaN, 2, 30)).toBeNull();
    const { project } = fixture();
    expect(deleteTimelineRange(project, { start: 1, end: 1 })).toBe(project);
  });
  it("仅挖除范围内内容，保留外部时间、源区间、动画和淡出时钟", () => {
    const { project, video } = fixture();
    const result = deleteTimelineRange(project, { start: 3, end: 5 });
    const videos = result.clips.filter((clip) => clip.kind === "video");
    expect(
      videos.map((clip) => [clip.start, clip.duration, clip.sourceIn]),
    ).toEqual([
      [1, 2, 2],
      [5, 4, 10],
    ]);
    expect(transformAt(videos[1], 1)).toEqual(transformAt(video, 5));
    expect(fadeOpacity(videos[0], 1.8)).toBeCloseTo(fadeOpacity(video, 1.8));
    expect(fadeOpacity(videos[1], 3)).toBeCloseTo(fadeOpacity(video, 7));
    expect(result.clips.find((clip) => clip.trackId === "audio")?.start).toBe(
      12,
    );
    expect(result.markers).toBe(project.markers);
    expect(project.clips).toHaveLength(3);
    expect(validateProject(result)).toBeDefined();
  });
  it("波纹删除收拢所有可编辑轨道及标记，包括选区内原有空白", () => {
    const { project } = fixture();
    const result = deleteTimelineRange(project, { start: 3, end: 5 }, true);
    expect(
      result.clips
        .filter((clip) => clip.kind === "video")
        .map((clip) => [clip.start, clip.duration, clip.sourceIn]),
    ).toEqual([
      [1, 2, 2],
      [3, 4, 10],
    ]);
    expect(result.clips.find((clip) => clip.trackId === "audio")?.start).toBe(
      10,
    );
    expect(
      result.markers.map((marker) => [marker.time, marker.duration]),
    ).toEqual([
      [3, 3],
      [9, undefined],
    ]);
    const empty = createProject();
    empty.clips = [newText("video", 10)];
    expect(
      deleteTimelineRange(empty, { start: 2, end: 4 }, true).clips[0].start,
    ).toBe(8);
  });
  it("锁定轨道及含锁定成员的组合保持原样", () => {
    const { project } = fixture();
    project.tracks[0].locked = true;
    project.clips[0].groupId = "group";
    project.clips[1].groupId = "group";
    const result = deleteTimelineRange(project, { start: 3, end: 5 }, true);
    expect(result.clips[0]).toBe(project.clips[0]);
    expect(result.clips[1]).toBe(project.clips[1]);
    expect(result.clips[2].start).toBe(10);
  });
  it("边界切分组合并保持组内音画同步；全选删除不残留零时长片段", () => {
    const { project } = fixture();
    project.clips[0].groupId = "group";
    project.clips[1].groupId = "group";
    const result = deleteTimelineRange(project, { start: 3, end: 5 }, true);
    const rightVideo = result.clips.find(
      (clip) => clip.kind === "video" && clip.start === 3,
    )!;
    const rightTitle = result.clips.find(
      (clip) => clip.kind === "text" && clip.start === 3,
    )!;
    expect(rightVideo.groupId).toBe(rightTitle.groupId);
    expect(rightVideo.groupId).not.toBe(project.clips[0].groupId);
    expect(validateProject(result)).toBeDefined();
    expect(deleteTimelineRange(project, { start: 0, end: 30 }).clips).toEqual(
      [],
    );
  });
});

describe("范围波纹删除自动拼接", () => {
  function videoProject() {
    const { project, video } = fixture();
    project.clips = [{ ...video, fadeIn: 0, fadeOut: 0, keyframes: [] }];
    return project;
  }

  it("开启后合并接口，保留变速源区间；连续删除及移除拼接不恢复被删内容", () => {
    const project = videoProject();
    const original = structuredClone(project);
    const result = deleteTimelineRange(
      project,
      { start: 3, end: 5 },
      true,
      true,
    );
    expect(result.clips).toHaveLength(1);
    expect(result.clips[0]).toMatchObject({
      id: project.clips[0].id,
      start: 1,
      duration: 6,
      speed: 2,
      stitch: [
        { sourceIn: 2, duration: 4 },
        { sourceIn: 10, duration: 8 },
      ],
    });
    expect(sourceTimeAt(result.clips[0], 2)).toBe(10);
    const repeated = deleteTimelineRange(
      result,
      { start: 4, end: 5 },
      true,
      true,
    );
    expect(repeated.clips).toHaveLength(1);
    expect(repeated.clips[0].duration).toBe(5);
    expect(
      mediaSegments(repeated.clips[0]).map(({ sourceIn, duration }) => [
        sourceIn,
        duration,
      ]),
    ).toEqual([
      [2, 4],
      [10, 2],
      [14, 4],
    ]);
    expect(
      unstitchClips(repeated, [repeated.clips[0].id]).clips.map((clip) => [
        clip.start,
        clip.duration,
        clip.sourceIn,
      ]),
    ).toEqual([
      [1, 2, 2],
      [3, 1, 10],
      [4, 2, 14],
    ]);
    expect(
      validateProject(JSON.parse(JSON.stringify(repeated))).clips,
    ).toHaveLength(1);
    expect(project).toEqual(original);
  });

  it("关闭时及普通删除保留两个片段，删除首尾或无效范围不凭空拼接", () => {
    const project = videoProject();
    const range = { start: 3, end: 5 };
    expect(deleteTimelineRange(project, range, true).clips).toHaveLength(2);
    expect(deleteTimelineRange(project, range, false, true).clips).toHaveLength(
      2,
    );
    for (const range of [
      { start: 0, end: 3 },
      { start: 5, end: 10 },
    ]) {
      const result = deleteTimelineRange(project, range, true, true);
      expect(result.clips).toHaveLength(1);
      expect(result.clips[0].stitch).toBeUndefined();
    }
    expect(deleteTimelineRange(project, { start: 3, end: 3 }, true, true)).toBe(
      project,
    );
  });

  it("标记位于已有片段边界时也拼接同源片段", () => {
    const project = videoProject();
    const video = project.clips[0];
    project.clips = [
      { ...video, duration: 2 },
      { ...video, id: "right", start: 5, duration: 3, sourceIn: 10 },
    ];
    const result = deleteTimelineRange(
      project,
      { start: 3, end: 5 },
      true,
      true,
    );
    expect(result.clips).toHaveLength(1);
    expect(result.clips[0]).toMatchObject({
      start: 1,
      duration: 5,
      stitch: [
        { sourceIn: 2, duration: 4 },
        { sourceIn: 10, duration: 6 },
      ],
    });
  });

  it("只拼接各轨删除接口处的片段，不连带合并其他相邻片段", () => {
    const project = videoProject();
    const video = project.clips[0];
    project.clips.push(
      { ...video, id: "later", start: 9, duration: 1, sourceIn: 18 },
      { ...video, id: "audio", kind: "audio", trackId: "audio" },
    );
    const result = deleteTimelineRange(
      project,
      { start: 3, end: 5 },
      true,
      true,
    );
    expect(result.clips).toHaveLength(3);
    expect(result.clips.find((clip) => clip.id === "later")).toMatchObject({
      start: 7,
      duration: 1,
    });
    expect(
      result.clips.find((clip) => clip.id === "later")?.stitch,
    ).toBeUndefined();
    for (const id of [video.id, "audio"])
      expect(result.clips.find((clip) => clip.id === id)?.stitch).toHaveLength(
        2,
      );
  });

  it("不同源、属性不兼容、组合和锁定轨道不强行拼接", () => {
    for (const change of [
      (clip: Clip) => {
        clip.assetId = "other";
      },
      (clip: Clip) => {
        clip.volume = 0.5;
      },
      (clip: Clip) => {
        clip.groupId = "group";
      },
      (clip: Clip) => {
        clip.transitions = {
          incoming: {
            type: "fade",
            duration: 0.5,
            reverse: false,
            enabled: true,
          },
        };
      },
    ]) {
      const project = videoProject();
      const left = { ...project.clips[0], duration: 2 };
      const right = { ...left, id: "right", start: 5, sourceIn: 10 };
      change(right);
      project.clips = [left, right];
      const result = deleteTimelineRange(
        project,
        { start: 3, end: 5 },
        true,
        true,
      );
      expect(result.clips).toHaveLength(2);
      expect(result.clips[1].stitch).toBeUndefined();
    }
    const animated = fixture().project;
    expect(
      deleteTimelineRange(
        animated,
        { start: 3, end: 5 },
        true,
        true,
      ).clips.filter((clip) => clip.kind === "video"),
    ).toHaveLength(2);
    const locked = videoProject();
    locked.tracks.find((track) => track.id === "video")!.locked = true;
    expect(deleteTimelineRange(locked, { start: 3, end: 5 }, true, true)).toBe(
      locked,
    );
  });
});
