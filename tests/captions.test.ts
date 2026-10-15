import { describe, expect, it } from "vitest";
import { createProject, newText, validateProject } from "../shared/model";
import {
  appendCaptionCues,
  captionClips,
  captionDefaults,
  captionTrackSelection,
  convertCaptionsToText,
  mergeWithPreviousCaption,
  replaceCaptionText,
  updateCaptionAppearance,
} from "../shared/captions";
import { availableTrack } from "../shared/editor";

describe("字幕轨道与批量编辑", () => {
  it("新字幕使用 30 号字和底部居中位置，普通文本默认样式不变", () => {
    const project = createProject();
    const text = newText(project.tracks[0].id, 0);
    const result = appendCaptionCues(project, [
      { start: 0, end: 1, text: "字幕" },
    ]);
    const caption = captionClips(result.project)[0];
    expect(caption.style).toMatchObject({ fontSize: 30, outlineWidth: 2 });
    expect(caption.transform).toMatchObject({ x: 0.5, y: 0.92 });
    expect(text.style!.fontSize).toBe(68);
  });

  it("点击字幕只圈选同轨字幕，并将点击的这一句保留为当前编辑对象", () => {
    const first = appendCaptionCues(createProject(), [
      { start: 0, end: 1, text: "第一句" },
      { start: 1, end: 2, text: "第二句" },
    ]);
    const second = appendCaptionCues(
      first.project,
      [{ start: 0, end: 1, text: "另一轨" }],
      { newTrack: true },
    );
    const selection = captionTrackSelection(second.project, first.ids[0]);
    expect(selection).toEqual([first.ids[1], first.ids[0]]);
    expect(selection).not.toContain(second.ids[0]);
  });

  it("批量样式和位置保留逐句内容、时间与动画，不影响普通文本、其他轨道和锁定轨道", () => {
    const first = appendCaptionCues(createProject(), [
      { start: 0, end: 1, text: "第一句" },
      { start: 2, end: 4, text: "第二句" },
    ]);
    const { project } = appendCaptionCues(
      first.project,
      [{ start: 0, end: 1, text: "另一轨" }],
      { newTrack: true },
    );
    const source = project.clips.find((clip) => clip.id === first.ids[0])!;
    source.keyframes = [
      {
        time: 0,
        value: {
          ...source.transform,
          y: source.transform.y + 0.05,
          opacity: 0,
        },
      },
      { time: 1, value: { ...source.transform, opacity: 1 } },
    ];
    const ordinary = newText(source.trackId, 4, 0, "保留普通文本");
    project.clips.push(ordinary);
    const updated = updateCaptionAppearance(project, source.id, {
      style: { ...source.style!, fontSize: 42, color: "#ffff00" },
      transform: { x: 0.4, y: 0.8 },
    });
    for (const id of first.ids) {
      const before = project.clips.find((clip) => clip.id === id)!;
      const after = updated.clips.find((clip) => clip.id === id)!;
      expect(after.style).toMatchObject({ fontSize: 42, color: "#ffff00" });
      expect(after.transform).toMatchObject({ x: 0.4, y: 0.8 });
      expect([after.text, after.start, after.duration]).toEqual([
        before.text,
        before.start,
        before.duration,
      ]);
    }
    expect(updated.clips[0].keyframes[0].value.y).toBeCloseTo(0.85);
    expect(updated.clips[0].keyframes[0].value.opacity).toBe(0);
    expect(updated.clips[0].keyframes[1].value.y).toBeCloseTo(0.8);
    // Add to the first dedicated track, so explicitly put the edited track first.
    const sameTrack = appendCaptionCues(
      {
        ...updated,
        tracks: [...updated.tracks].sort(
          (a, b) =>
            Number(b.id === source.trackId) - Number(a.id === source.trackId),
        ),
      },
      [{ start: 5, end: 6, text: "同轨新增" }],
    );
    const newCaption = sameTrack.project.clips.find(
      (clip) => clip.id === sameTrack.ids[0],
    )!;
    expect(newCaption.style).toMatchObject({ fontSize: 42, color: "#ffff00" });
    expect(newCaption.transform).toMatchObject({ x: 0.4, y: 0.8 });
    expect(newCaption.keyframes).toEqual([]);
    for (const clip of project.clips.filter(
      (clip) => !first.ids.includes(clip.id),
    ))
      expect(updated.clips.find((item) => item.id === clip.id)).toBe(clip);
    const locked = {
      ...project,
      tracks: project.tracks.map((track) =>
        track.id === source.trackId ? { ...track, locked: true } : track,
      ),
    };
    expect(
      updateCaptionAppearance(locked, source.id, {
        transform: { y: captionDefaults.y },
      }),
    ).toBe(locked);
    validateProject(updated);
  });

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

  it("每次语音识别都新建字幕轨道，已有识别结果保持原轨", () => {
    const first = appendCaptionCues(
      createProject(),
      [{ start: 0, end: 1, text: "第一次识别" }],
      { newTrack: true },
    );
    const firstTrackId = first.project.clips.find(
      (clip) => clip.id === first.ids[0],
    )!.trackId;
    const second = appendCaptionCues(
      first.project,
      [{ start: 0, end: 1, text: "第二次识别" }],
      { newTrack: true },
    );
    const secondTrackId = second.project.clips.find(
      (clip) => clip.id === second.ids[0],
    )!.trackId;

    expect(
      second.project.tracks.filter((track) => track.captionTrack),
    ).toHaveLength(2);
    expect(secondTrackId).not.toBe(firstTrackId);
    expect(
      second.project.clips.find((clip) => clip.id === first.ids[0])!.trackId,
    ).toBe(firstTrackId);
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
