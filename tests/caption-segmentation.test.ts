import { describe, expect, it } from "vitest";
import { appendCaptionCues, captionClips } from "../shared/captions";
import {
  captionSegmentationGroups,
  applyCaptionSegmentation,
} from "../shared/caption-segmentation";
import {
  captionProcessingSchema,
  segmentCaptionCues,
} from "../shared/caption-processing";
import { createProject, validateProject } from "../shared/model";

describe("已有字幕重新断句", () => {
  const fixture = () =>
    appendCaptionCues(createProject(), [
      { start: 0, end: 2, text: "你就直接和豆包提供数" },
      { start: 2, end: 4, text: "据，指定分析方法，让它画图就可以了。" },
      { start: 7, end: 8, text: "停顿之后。" },
    ]);
  it("按原字幕时间重新组合被拆开的词，保持样式和较长停顿", () => {
    const { project, ids } = fixture();
    project.clips.forEach((clip) => {
      clip.style!.fontSize = 52;
      clip.transform.y = 0.88;
    });
    const groups = captionSegmentationGroups(project, ids);
    expect(groups).toHaveLength(2);
    expect(groups[0].cue.text).toBe(
      "你就直接和豆包提供数据，指定分析方法，让它画图就可以了。",
    );
    const results = groups.map((group) => ({
      group,
      cues: segmentCaptionCues([group.cue], captionProcessingSchema.parse({})),
    }));
    const updated = applyCaptionSegmentation(project, results);
    expect(updated.changed).toBe(2);
    const captions = captionClips(updated.project);
    expect(
      captions.every(
        (clip) => clip.style!.fontSize === 52 && clip.transform.y === 0.88,
      ),
    ).toBe(true);
    expect(
      captions.some(
        (clip) => clip.text!.endsWith("数") || clip.text!.startsWith("据"),
      ),
    ).toBe(false);
    expect(
      captions.every(
        (clip) => clip.start + clip.duration <= 4 || clip.start >= 7,
      ),
    ).toBe(true);
    expect(captions.map((clip) => clip.text).join("")).toBe(
      project.clips.map((clip) => clip.text).join(""),
    );
    expect(updated.project.clips.find((clip) => clip.id === ids[2])).toBe(
      project.clips[2],
    );
    validateProject(updated.project);
  });

  it("不跨轨道、未选中的片段、不同样式或重叠字幕合并", () => {
    const { project, ids } = fixture();
    expect(captionSegmentationGroups(project, [ids[0], ids[2]])).toHaveLength(
      2,
    );
    project.clips[1].style!.color = "#ffff00";
    expect(captionSegmentationGroups(project, ids)).toHaveLength(3);
    const other = appendCaptionCues(
      project,
      [{ start: 0, end: 4, text: "另一轨" }],
      { newTrack: true },
    );
    expect(
      captionSegmentationGroups(other.project, [...ids, ...other.ids]),
    ).toHaveLength(4);
    project.clips[1].style!.color = project.clips[0].style!.color;
    project.clips[1].start = 1;
    expect(captionSegmentationGroups(project, ids)).toHaveLength(3);
  });

  it("新建字幕和从项目恢复的字幕按属性值比较样式，不依赖字段顺序", () => {
    const { project, ids } = fixture();
    project.clips[0] = validateProject(project).clips[0];
    expect(captionSegmentationGroups(project, ids)[0].clips).toHaveLength(2);
  });

  it("不限制长度可将相邻字幕合回一条，操作无变化时不写入历史", () => {
    const { project, ids } = fixture();
    const groups = captionSegmentationGroups(project, ids);
    const updated = applyCaptionSegmentation(
      project,
      groups.map((group) => ({
        group,
        cues: segmentCaptionCues(
          [group.cue],
          captionProcessingSchema.parse({ segmentation: "unlimited" }),
        ),
      })),
    );
    expect(captionClips(updated.project)).toHaveLength(2);
    expect(captionClips(updated.project)[0].duration).toBe(4);
    const again = captionSegmentationGroups(updated.project, updated.ids);
    expect(
      applyCaptionSegmentation(
        updated.project,
        again.map((group) => ({ group, cues: [group.cue] })),
      ).project,
    ).toBe(updated.project);
  });

  it("后台处理期间修改或锁定的字幕保持原样，非法结果不覆盖原字幕", () => {
    const { project, ids } = fixture();
    const group = captionSegmentationGroups(project, ids)[0];
    const cues = segmentCaptionCues(
      [group.cue],
      captionProcessingSchema.parse({}),
    );
    const locked = {
      ...project,
      tracks: project.tracks.map((track) => ({ ...track, locked: true })),
    };
    expect(captionSegmentationGroups(locked, ids)).toEqual([]);
    expect(applyCaptionSegmentation(locked, [{ group, cues }]).project).toBe(
      locked,
    );
    const edited = {
      ...project,
      clips: project.clips.map((clip, index) =>
        index === 0 ? { ...clip, text: "已编辑" } : clip,
      ),
    };
    expect(applyCaptionSegmentation(edited, [{ group, cues }]).project).toBe(
      edited,
    );
    expect(() =>
      applyCaptionSegmentation(project, [
        { group, cues: [{ start: 0, end: 4, text: "错误内容" }] },
      ]),
    ).toThrow("断句结果与原字幕不一致");
  });
});
