import { describe, expect, it } from "vitest";
import { RustTimelineIndex } from "../shared/rust-engine";
import { projectIndex } from "../shared/project-index";
import { createProject, newText, projectDuration } from "../shared/model";
import { transitionRange, addTransition } from "../shared/transitions";

describe("真实 Rust Wasm 时间线引擎", () => {
  it("处理重叠、边界、无效区间、轨道筛选及释放", () => {
    const index = new RustTimelineIndex();
    try {
      index.add(4, 0, -2, 50);
      index.add(1, 1, 3, 5);
      index.add(2, 0, 5, 6);
      index.build();
      expect(index.query(5)).toEqual([2, 4]);
      expect(index.query(5, 5, 1, true)).toEqual([1]);
      expect(index.query(6, 7, 0)).toEqual([4]);
      expect(index.query(7, 6)).toEqual([]);
      expect(index.query(NaN)).toEqual([]);
      expect(() => index.add(5, 0, 7, 6)).toThrow();
    } finally {
      index.dispose();
    }
    expect(() => index.query(0)).toThrow("已释放");
    index.dispose();
  });

  it("通过 ABI 的随机查询与原线性算法一致", () => {
    const index = new RustTimelineIndex();
    let seed = 13;
    const random = () =>
      (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    const clips = Array.from({ length: 10000 }, (_, id) => {
      const start = random() * 1000;
      return {
        id,
        track: Math.floor(random() * 32),
        start,
        end: start + random() * 200,
      };
    });
    try {
      for (const clip of clips)
        index.add(clip.id, clip.track, clip.start, clip.end);
      index.build();
      for (let i = 0; i < 200; i++) {
        const start = random() * 1000,
          end = start + (i % 2 ? 10 : 0);
        const track = i % 3 ? -1 : Math.floor(random() * 32);
        const closed = !!(i % 2);
        const expected = clips
          .filter(
            (c) =>
              (track === -1 || c.track === track) &&
              (closed
                ? c.start <= end && c.end >= start
                : (start === end ? c.start <= end : c.start < end) &&
                  c.end > start),
          )
          .map((c) => c.id);
        expect(index.query(start, end, track, closed)).toEqual(expected);
      }
    } finally {
      index.dispose();
    }
  });

  it("保持成对转场、关键帧片尾和拖动可见语义", () => {
    let project = createProject();
    project.clips = [newText("video", 0), newText("video", 5)];
    project = addTransition(project, {
      clipId: project.clips[0].id,
      side: "outgoing",
      neighborId: project.clips[1].id,
    });
    for (const time of [-1, 0, 4.5, 4.9, 5, 5.1, 5.49, 5.5, 10]) {
      const expected = project.clips.filter((clip) => {
        const range = transitionRange(project, clip);
        return time >= range.start && time < range.end;
      });
      expect(projectIndex(project).active(project, time)).toEqual(expected);
    }
    expect(
      projectIndex(project).active(project, 10, project.clips[1].id),
    ).toEqual([project.clips[1]]);
    expect(
      projectIndex(project).visible("video", 40, 60, [project.clips[0].id]),
    ).toEqual([project.clips[0]]);
    expect(projectIndex(project).visible("missing", 0, 10)).toEqual([]);
  });

  it("编辑、撤销、缓存淘汰后重建，不使用旧区间", () => {
    const before = createProject();
    before.clips = [newText("video", 2)];
    expect(projectIndex(before).active(before, 3)).toHaveLength(1);
    const after = { ...before, clips: [{ ...before.clips[0], start: 20 }] };
    expect(projectIndex(after).active(after, 3)).toEqual([]);
    for (let i = 0; i < 20; i++) {
      const snapshot = {
        ...before,
        clips: [{ ...before.clips[0], start: i * 10 }],
      };
      expect(projectIndex(snapshot).active(snapshot, i * 10)).toHaveLength(1);
    }
    expect(projectIndex(before).active(before, 3)).toHaveLength(1);
    expect(projectIndex(after).active(after, 21)).toHaveLength(1);
  });

  it("缩放预览草稿复用源时间索引并返回当前变换", () => {
    const project = createProject();
    project.clips = [newText("video", 0)];
    const drafts = [
      {
        ...project.clips[0],
        transform: { ...project.clips[0].transform, scale: 2 },
      },
    ];
    expect(projectIndex(project).active(project, 1, undefined, drafts)[0]).toBe(
      drafts[0],
    );
    expect(projectIndex(project).active(project, 1)[0]).toBe(project.clips[0]);
  });

  it("十万片段计算时长不触发参数栈溢出", () => {
    const project = createProject();
    const clip = newText("video", 0);
    project.clips = Array.from({ length: 100000 }, (_, i) => ({
      ...clip,
      start: i,
    }));
    expect(projectDuration(project)).toBe(100004);
  });
});
