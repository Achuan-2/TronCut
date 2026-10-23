import { describe, expect, it } from "vitest";
import { createProject, newText, validateProject } from "../shared/model";
import { splitClip } from "../shared/editor";
import {
  setTimelineClipColor,
  timelineClipColors,
  timelineClipTextColor,
} from "../shared/timeline-clip-color";

function fixture() {
  const project = createProject();
  project.tracks.push({
    id: "locked",
    name: "锁定",
    hidden: false,
    muted: false,
    locked: true,
  });
  project.clips = [
    newText("titles", 0),
    newText("titles", 6),
    newText("locked", 0),
  ];
  return project;
}

describe("时间线素材颜色", () => {
  it("批量设置预设和自定义颜色，只修改时间线元数据并通过项目校验", () => {
    const project = fixture();
    const ids = project.clips.slice(0, 2).map((clip) => clip.id);
    const next = setTimelineClipColor(project, ids, "#ABCDEF");
    for (let i = 0; i < 2; i++) {
      expect(next.clips[i]).toEqual({
        ...project.clips[i],
        timelineColor: "#abcdef",
      });
      expect(next.clips[i].style).toBe(project.clips[i].style);
      expect(next.clips[i].keyframes).toBe(project.clips[i].keyframes);
    }
    expect(next.clips[2]).toBe(project.clips[2]);
    expect(validateProject(JSON.parse(JSON.stringify(next))).clips).toEqual(
      next.clips,
    );
    for (const preset of timelineClipColors)
      expect(
        setTimelineClipColor(project, ids, preset.color).clips[0].timelineColor,
      ).toBe(preset.color);
  });

  it("默认颜色移除字段；重复应用、非法颜色和空选区不产生修改", () => {
    const project = fixture(),
      ids = [project.clips[0].id];
    const colored = setTimelineClipColor(project, ids, "#ffffff");
    expect(setTimelineClipColor(colored, ids, "#ffffff")).toBe(colored);
    expect(setTimelineClipColor(colored, ids).clips[0]).not.toHaveProperty(
      "timelineColor",
    );
    expect(setTimelineClipColor(project, ids)).toBe(project);
    for (const color of ["red", "#fff", "#12345z", "#12345678"])
      expect(setTimelineClipColor(project, ids, color)).toBe(project);
    expect(setTimelineClipColor(project, [], "#abcdef")).toBe(project);
  });

  it("组成员统一着色，含锁定素材的选区整体拒绝修改", () => {
    const project = fixture();
    project.clips[0].groupId = project.clips[1].groupId = "group";
    const next = setTimelineClipColor(
      project,
      [project.clips[0].id],
      "#527db6",
    );
    expect(next.clips.slice(0, 2).map((clip) => clip.timelineColor)).toEqual([
      "#527db6",
      "#527db6",
    ]);
    expect(
      setTimelineClipColor(
        project,
        project.clips.map((clip) => clip.id),
        "#527db6",
      ),
    ).toBe(project);
  });

  it("拆分后两段继承颜色，默认旧项目无需补字段", () => {
    const project = fixture();
    const colored = setTimelineClipColor(
      project,
      [project.clips[0].id],
      "#ba5555",
    );
    const split = splitClip(colored, colored.clips[0].id, 2);
    expect(
      split.clips.filter((clip) => clip.timelineColor === "#ba5555"),
    ).toHaveLength(2);
    expect(validateProject(project).clips[0]).not.toHaveProperty(
      "timelineColor",
    );
  });

  it("深色底使用白字，浅色底使用深色字", () => {
    expect(timelineClipTextColor("#000000")).toBe("#ffffff");
    expect(timelineClipTextColor("#ffffff")).toBe("#111111");
    expect(timelineClipTextColor("#ffeeaa")).toBe("#111111");
  });
});
