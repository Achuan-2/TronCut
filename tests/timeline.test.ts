import { describe, expect, it } from "vitest";
import { createProject, newText, validateProject } from "../shared/model";
import {
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
  it("波纹删除保留其他轨重叠内容，仅关闭真正空出的时间", () => {
    const p = createProject();
    const removed = newText("titles", 1),
      overlap = newText("video", 2),
      later = newText("video", 8);
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
