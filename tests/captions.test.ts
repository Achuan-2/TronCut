import { describe, expect, it } from "vitest";
import { createProject, newText, validateProject } from "../shared/model";
import {
  appendCaptionCues,
  captionClips,
  convertCaptionsToText,
  mergeWithPreviousCaption,
  replaceCaptionText,
} from "../shared/captions";
import { availableTrack } from "../shared/editor";

describe("字幕轨道与批量编辑", () => {
  it("导入和新增字幕始终复用独立字幕轨道", () => {
    const project = createProject();
    project.clips = [newText(project.tracks[0].id, 0, 0, "普通文本")];
    const first = appendCaptionCues(project, [
      { start: 1, end: 2, text: "第一条" },
      { start: 2, end: 3, text: "第二条" },
    ]);
    const captionTrack = first.project.tracks.find(
      (track) => track.captionTrack,
    );
    expect(captionTrack).toBeDefined();
    expect(
      captionClips(first.project).every(
        (clip) => clip.trackId === captionTrack!.id,
      ),
    ).toBe(true);
    expect(first.project.clips[0].trackId).not.toBe(captionTrack!.id);
    expect(
      availableTrack(
        {
          tracks: [captionTrack!],
          clips: first.project.clips.filter(
            (clip) => clip.trackId !== captionTrack!.id,
          ),
        },
        10,
        1,
      ),
    ).toBeUndefined();

    const second = appendCaptionCues(first.project, [
      { start: 4, end: 5, text: "第三条" },
    ]);
    expect(
      second.project.tracks.filter((track) => track.captionTrack),
    ).toHaveLength(1);
    expect(validateProject(second.project).clips).toHaveLength(4);
  });

  it("搜索替换跳过锁定轨道，并支持将单条字幕转成普通文本", () => {
    const base = appendCaptionCues(createProject(), [
      { start: 0, end: 1, text: "需要替换" },
      { start: 1, end: 2, text: "也需要替换" },
    ]).project;
    const replaced = replaceCaptionText(base, "需要", "已经");
    expect(replaced.changed).toBe(2);
    expect(captionClips(replaced.project).map((clip) => clip.text)).toEqual([
      "已经替换",
      "也已经替换",
    ]);

    const first = captionClips(replaced.project)[0];
    const converted = convertCaptionsToText(replaced.project, [first.id]);
    expect(converted.ids).toEqual([first.id]);
    expect(
      converted.project.clips.find((clip) => clip.id === first.id)?.caption,
    ).toBe(false);
    expect(captionClips(converted.project)).toHaveLength(1);
    expect(
      converted.project.tracks.find(
        (track) =>
          track.id ===
          converted.project.clips.find((clip) => clip.id === first.id)?.trackId,
      )?.captionTrack,
    ).not.toBe(true);

    const locked = {
      ...base,
      tracks: base.tracks.map((track) =>
        track.captionTrack ? { ...track, locked: true } : track,
      ),
    };
    expect(replaceCaptionText(locked, "需要", "不能").changed).toBe(0);
  });

  it("与上一字幕合并时保留开始时间并覆盖完整区间", () => {
    const project = appendCaptionCues(createProject(), [
      { start: 2, end: 3, text: "上一条" },
      { start: 4, end: 6, text: "当前条" },
    ]).project;
    const current = captionClips(project)[1];
    const merged = mergeWithPreviousCaption(project, current.id);
    expect(merged.selectedId).toBe(captionClips(project)[0].id);
    expect(captionClips(merged.project)).toMatchObject([
      { start: 2, duration: 4, text: "上一条\n当前条" },
    ]);
  });
});
