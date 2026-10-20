import { expect, it } from "vitest";
import { createProject, newText, newTrack, validateProject } from "../shared/model";
import { pasteClips } from "../shared/timeline";
import { rootGroupId } from "../shared/clip-groups";
import { hasProjectTimelineOverlap } from "../shared/timeline-collision";

function fixture() {
  const project = createProject();
  project.tracks = [newTrack(0), newTrack(1), newTrack(2)];
  const source = newText(project.tracks[1].id, 5, 0, "复制对象");
  source.duration = 5;
  source.transform.x = 0.3;
  source.keyframes = [{ time: 1, value: { ...source.transform, scale: 2 } }];
  project.clips = [source];
  return { project, source, top: project.tracks[0] };
}

it("最顶层在原时间位置有空间时复用，副本保留时间、属性与动画", () => {
  const { project, source, top } = fixture();
  project.clips.push(newText(top.id, 20));
  const result = pasteClips(project, [source], source.start, { pasteToTop: true });
  const copy = result.project.clips.find((clip) => result.ids.includes(clip.id))!;
  expect(result.project.tracks).toHaveLength(project.tracks.length);
  expect(copy).toEqual({ ...source, id: copy.id, trackId: top.id });
  expect(copy.id).not.toBe(source.id);
  expect(copy.keyframes).not.toBe(source.keyframes);
  expect(copy.style).not.toBe(source.style);
  expect(project.clips[0]).toBe(source);
  expect(hasProjectTimelineOverlap(result.project)).toBe(false);
  expect(validateProject(result.project).clips).toHaveLength(3);
});

it.each(["occupied", "locked", "hidden", "captions"])(
  "最顶层不可用（%s）时新增顶层轨道，不把副本向右移动",
  (reason) => {
    const { project, source, top } = fixture();
    if (reason === "occupied") project.clips.push(newText(top.id, 5));
    if (reason === "locked") top.locked = true;
    if (reason === "hidden") top.hidden = true;
    if (reason === "captions") top.captionTrack = true;
    const result = pasteClips(project, [source], source.start, { pasteToTop: true });
    const copy = result.project.clips.at(-1)!;
    expect(result.project.tracks).toHaveLength(4);
    expect(copy.trackId).toBe(result.project.tracks[0].id);
    expect(copy.trackId).not.toBe(top.id);
    expect(copy.start).toBe(source.start);
    expect(copy.duration).toBe(source.duration);
    expect(project.tracks).toHaveLength(3);
    expect(hasProjectTimelineOverlap(result.project)).toBe(false);
  },
);

it("多选及嵌套组合保留相对时间、上下层级和独立的组合关系", () => {
  const { project, source, top } = fixture();
  const bottom = newText(project.tracks[2].id, 7, 0, "下层对象");
  source.groupId = "nested";
  bottom.groupId = "root";
  project.groups = [
    { id: "root", name: "组合" },
    { id: "nested", name: "子组合", parentId: "root" },
  ];
  project.clips.push(bottom);
  const result = pasteClips(project, [source, bottom], 5, { pasteToTop: true });
  const [a, b] = result.project.clips.filter((clip) => result.ids.includes(clip.id));
  expect([a.start, b.start]).toEqual([5, 7]);
  expect(a.trackId).toBe(result.project.tracks[0].id);
  expect(b.trackId).toBe(top.id);
  expect(a.groupId).not.toBe(source.groupId);
  expect(b.groupId).not.toBe(bottom.groupId);
  expect(rootGroupId(result.project, a.groupId)).toBe(b.groupId);
  expect(result.project.groups!.find((group) => group.id === a.groupId)?.name)
    .toBe("子组合");
  expect(hasProjectTimelineOverlap(result.project)).toBe(false);
  expect(validateProject(result.project).clips).toHaveLength(4);
});

it("轨道达到上限时仍可复用空闲顶层，不能新增时保持项目完整", () => {
  const { project, source, top } = fixture();
  while (project.tracks.length < 128) project.tracks.push(newTrack(project.tracks.length));
  expect(pasteClips(project, [source], 5, { pasteToTop: true }).ids).toHaveLength(1);
  project.clips.push(newText(top.id, 5));
  const result = pasteClips(project, [source], 5, { pasteToTop: true });
  expect(result).toEqual({ project, ids: [] });
  expect(result.project).toBe(project);
});
