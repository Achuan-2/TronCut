import { describe, expect, it } from "vitest";
import { createProject, newText, validateProject } from "../shared/model";
import {
  clipsInTimelineRange,
  deleteClips,
  groupSelection,
  moveClips,
  pasteClips,
  selectionWithGroups,
  splitSelection,
} from "../shared/timeline";
import { defaultCrop, defaultEffects, fadeOpacity } from "../shared/effects";

describe("多片段编辑与波纹时间映射", () => {
  it("一起移动时以最早片段限制负时间，锁定轨保持不变", () => {
    const p = createProject();
    p.clips = [newText("titles", 2), newText("video", 4), newText("audio", 6)];
    p.tracks[2].locked = true;
    const moved = moveClips(
      p,
      p.clips.map((c) => c.id),
      -10,
    );
    expect(moved.clips.map((c) => c.start)).toEqual([0, 2, 6]);
    expect(p.clips.map((c) => c.start)).toEqual([2, 4, 6]);
  });
  it("波纹删除保留同轨重叠内容，仅关闭该轨真正空出的时间", () => {
    const p = createProject();
    const removed = newText("titles", 1),
      overlap = newText("titles", 2),
      later = newText("titles", 8);
    removed.duration = 5;
    overlap.duration = 2;
    p.clips = [removed, overlap, later];
    p.markers = [{ id: "marker", time: 7, label: "标记" }];
    const result = deleteClips(p, [removed.id], true);
    expect(result.clips.map((c) => [c.start, c.duration])).toEqual([
      [1, 2],
      [5, 5],
    ]);
    expect(result.markers[0].time).toBe(4);
    expect(overlap.sourceIn).toBe(0);
  });
  it("其他轨道的标题和配音不阻止视频波纹删除，也不跟随移动", () => {
    const p = createProject();
    const video = { ...newText("video", 0), duration: 7, sourceIn: 10 };
    const title = { ...newText("titles", 0), duration: 7 };
    const voice = { ...newText("audio", 0.4), duration: 4.3 };
    const laterTitle = newText("titles", 8);
    p.clips = [video, title, voice, laterTitle];
    const split = splitSelection(p, [video.id], 2.2);
    const middle = split.clips.find(
      (c) => c.trackId === "video" && c.start === 2.2,
    )!;
    const splitAgain = splitSelection(split, [middle.id], 3.5);
    const result = deleteClips(splitAgain, [middle.id], true);
    const videos = result.clips.filter((c) => c.trackId === "video");

    expect(videos).toHaveLength(2);
    expect(videos[0].start + videos[0].duration).toBeCloseTo(videos[1].start);
    expect(videos[1]).toMatchObject({
      start: 2.2,
      duration: 3.5,
      sourceIn: 13.5,
    });
    expect(result.clips.filter((c) => c.trackId !== "video")).toEqual([
      title,
      voice,
      laterTitle,
    ]);
    expect(p.clips).toEqual([video, title, voice, laterTitle]);
  });
  it("多轨选区共享波纹时间映射，同轨存活片段防止重叠", () => {
    const p = createProject();
    const removedVideo = { ...newText("video", 2), duration: 2 };
    const removedTitle = { ...newText("titles", 2), duration: 2 };
    const overlappingTitle = { ...newText("titles", 3), duration: 1 };
    const nextVideo = newText("video", 4);
    const nextTitle = newText("titles", 4);
    p.clips = [
      removedVideo,
      removedTitle,
      overlappingTitle,
      nextVideo,
      nextTitle,
    ];
    const result = deleteClips(p, [removedVideo.id, removedTitle.id], true);
    expect(result.clips.map((c) => [c.start, c.duration])).toEqual([
      [2, 1],
      [3, 5],
      [3, 5],
    ]);
  });
  it("锁定轨道即使覆盖删除区间也不会阻止其他轨道收拢", () => {
    const p = createProject();
    const removed = { ...newText("video", 1), duration: 2 };
    const later = newText("video", 3);
    const locked = { ...newText("audio", 0), duration: 10 };
    p.tracks[2].locked = true;
    p.clips = [removed, later, locked];
    const result = deleteClips(p, [removed.id, locked.id], true);
    expect(result.clips).toEqual([{ ...later, start: 1 }, locked]);
  });
  it("多段删除的重叠时长只计算一次，锁定片段不能删除", () => {
    const p = createProject();
    const a = newText("titles", 0),
      b = newText("video", 2),
      c = newText("titles", 8),
      locked = newText("audio", 10);
    p.clips = [a, b, c, locked];
    p.tracks[2].locked = true;
    const result = deleteClips(p, [a.id, b.id, locked.id], true);
    expect(result.clips.map((c) => c.start)).toEqual([1, 10]);
  });
  it("组合会一起选择，粘贴保留相对位置并生成独立组合", () => {
    const p = createProject();
    p.clips = [newText("titles", 1), newText("video", 3)];
    const grouped = groupSelection(
      p,
      p.clips.map((c) => c.id),
    );
    expect(selectionWithGroups(grouped, [p.clips[0].id])).toHaveLength(2);
    const pasted = pasteClips(grouped, grouped.clips, 8);
    expect(pasted.project.clips.slice(2).map((c) => c.start)).toEqual([8, 10]);
    expect(pasted.project.clips[2].groupId).not.toBe(grouped.clips[0].groupId);
    expect(pasted.project.clips[2].groupId).toBe(
      pasted.project.clips[3].groupId,
    );
    expect(validateProject(pasted.project).clips).toHaveLength(4);
  });
  it("框选按时间与轨道相交范围选中片段，并跳过锁定和隐藏轨", () => {
    const p = createProject();
    const first = newText("titles", 1);
    const second = newText("video", 4);
    const locked = newText("audio", 2);
    first.duration = 2;
    second.duration = 2;
    locked.duration = 2;
    p.clips = [first, second, locked];
    p.tracks[2].locked = true;

    expect(
      clipsInTimelineRange(p, 2.5, 4.5, ["titles", "video", "audio"]),
    ).toEqual([first.id, second.id]);
    p.tracks[1].hidden = true;
    expect(
      clipsInTimelineRange(p, 2.5, 4.5, ["titles", "video", "audio"]),
    ).toEqual([first.id]);
  });
  it("同时拆分穿过播放头的片段，不改动不相交和锁定片段", () => {
    const p = createProject();
    p.clips = [newText("titles", 0), newText("video", 1), newText("audio", 0)];
    p.tracks[2].locked = true;
    const result = splitSelection(
      p,
      p.clips.map((c) => c.id),
      3,
    );
    expect(result.clips.map((c) => c.duration)).toEqual([3, 2, 2, 3, 5]);
  });
});

describe("工程效果兼容与边界", () => {
  it("同时读取旧工程与新工程，但拒绝裁切掉整个画面", () => {
    const p = createProject();
    expect(validateProject({ ...p, format: "framecraft" }).format).toBe(
      "framecraft",
    );
    expect(p.format).toBe("troncut");
    p.clips = [
      {
        ...newText("titles", 0),
        crop: { ...defaultCrop, left: 0.6, right: 0.5 },
      },
    ];
    expect(() => validateProject(p)).toThrow("有效画面");
  });
  it("过长淡入淡出按比例缩短，接点没有亮度跳变", () => {
    const clip = {
      ...newText("titles", 0),
      duration: 1,
      fadeIn: 2,
      fadeOut: 2,
      effects: defaultEffects,
    };
    expect(fadeOpacity(clip, 0)).toBe(0);
    expect(fadeOpacity(clip, 0.5)).toBe(1);
    expect(fadeOpacity(clip, 1)).toBe(0);
  });
});
