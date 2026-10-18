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
