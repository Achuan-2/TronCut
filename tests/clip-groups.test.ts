import { describe, expect, it } from "vitest";
import { createProject, newText, validateProject } from "../shared/model";
import {
  createGroupScope,
  clampGroupTime,
  groupMembers,
  groupName,
  groupedTimeline,
  mergeGroupProject,
  projectForGroup,
  renameClipGroup,
  rootGroupId,
} from "../shared/clip-groups";
import {
  deleteClips,
  groupSelection,
  moveClips,
  moveClipGroup,
  pasteClips,
  selectionWithGroups,
  splitSelection,
} from "../shared/timeline";

function fixture() {
  const project = createProject("组合工程");
  project.clips = [
    newText("titles", 10, 0, "组内甲"),
    newText("video", 12, 0, "组内乙"),
    newText("titles", 30, 0, "组外"),
  ];
  project.markers = [{ id: "outside-marker", time: 11, label: "主时间线标记" }];
  const grouped = groupSelection(
    project,
    project.clips.slice(0, 2).map((clip) => clip.id),
  );
  return { project: grouped, id: grouped.clips[0].groupId! };
}

describe("组合时间线", () => {
  it("组合跨轨道移动保留成员层次与时间，底部不足时增加内部轨道", () => {
    const { project, id } = fixture();
    const result = moveClipGroup(project, id, 2, "audio");
    expect(result.tracks).toHaveLength(4);
    expect(result.clips[0]).toMatchObject({ trackId: "audio", start: 12 });
    expect(result.clips[1]).toMatchObject({
      trackId: result.tracks[3].id,
      start: 14,
    });
    expect(result.clips[2]).toBe(project.clips[2]);
    const proxy = groupedTimeline(result).clips.find(
      (clip) => clip.groupId === id,
    )!;
    expect(proxy).toMatchObject({ trackId: "audio", start: 12, duration: 7 });
    expect(validateProject(result).clips).toHaveLength(3);
  });

  it("组合跨轨道移动不会改动锁定目标或部分移动含锁定成员的组合", () => {
    const { project, id } = fixture();
    project.tracks.find((track) => track.id === "audio")!.locked = true;
    expect(moveClipGroup(project, id, 1, "audio")).toBe(project);
    expect(moveClipGroup(project, id, 1, "video")).toBe(project);
    project.tracks.find((track) => track.id === "titles")!.locked = true;
    expect(moveClipGroup(project, id, 1, "titles")).toBe(project);
  });

  it("组内使用主时间线刻度，旧标记映射到原位置，定位被限制在组合起止之间", () => {
    const { project, id } = fixture();
    project.groups!.find((group) => group.id === id)!.markers = [
      { id: "m", time: 1, label: "旧标记" },
    ];
    const scope = createGroupScope(project, id)!;
    expect(scope).toMatchObject({ offset: 10, end: 17 });
    const view = projectForGroup(project, scope);
    expect(view.clips.map((clip) => clip.start)).toEqual([10, 12]);
    expect(view.markers[0].time).toBe(11);
    expect(
      [-5, 0, 10, 12, 17, 30].map((time) => clampGroupTime(scope, time)),
    ).toEqual([10, 10, 10, 12, 17, 17]);
    expect(
      mergeGroupProject(project, scope, view).groups!.find(
        (group) => group.id === id,
      )!.markers![0].time,
    ).toBe(1);
  });
  it("组内新增和调整轨道顺序会写回工程，保持图层前后关系", () => {
    const { project, id } = fixture();
    const scope = createGroupScope(project, id)!;
    const local = projectForGroup(project, scope);
    const top = { ...local.tracks[0], id: "new-top-track" };
    const edited = { ...local, tracks: [top, ...[...local.tracks].reverse()] };
    const merged = mergeGroupProject(project, scope, edited);
    expect(merged.tracks.map((track) => track.id)).toEqual([
      "new-top-track",
      "video",
      "titles",
      "audio",
    ]);
  });

  it("组内移除媒体库素材时，不丢弃组外片段正在使用的源文件", () => {
    const { project, id } = fixture();
    project.assets = [
      {
        id: "outside-asset",
        path: "outside.png",
        name: "组外图片",
        kind: "image",
        duration: 0,
        width: 100,
        height: 100,
        hasAudio: false,
      },
    ];
    project.clips[2] = {
      ...project.clips[2],
      kind: "image",
      assetId: "outside-asset",
    };
    const scope = createGroupScope(project, id)!;
    const local = projectForGroup(project, scope);
    const merged = mergeGroupProject(project, scope, { ...local, assets: [] });
    expect(merged.assets).toEqual(project.assets);
    expect(validateProject(merged).clips).toHaveLength(3);
  });

  it("折叠组合在播放头拆分后成为两个可分别打开的组合", () => {
    const { project, id } = fixture();
    const split = splitSelection(project, [project.clips[0].id], 13);
    const timeline = groupedTimeline(split);
    expect(timeline.groups.size).toBe(2);
    expect(
      groupMembers(split, id).every((clip) => clip.start + clip.duration <= 13),
    ).toBe(true);
    const right = [...timeline.groups.values()].find(
      (group) => group.id !== id,
    )!;
    expect(
      groupMembers(split, right.id).every((clip) => clip.start >= 13),
    ).toBe(true);
    expect(validateProject(split).clips).toHaveLength(5);
  });

  it("含锁定成员的折叠组合不能被部分移动或删除", () => {
    const { project } = fixture();
    project.tracks.find((track) => track.id === "video")!.locked = true;
    const ids = selectionWithGroups(project, [project.clips[0].id]);
    expect(moveClips(project, ids, 3)).toBe(project);
    expect(deleteClips(project, ids)).toBe(project);
  });

  it("旧工程的 groupId 可直接打开，主时间线折叠后覆盖全部组内媒体", () => {
    const { project, id } = fixture();
    delete project.groups;
    const timeline = groupedTimeline(project);
    expect(timeline.clips).toHaveLength(2);
    const proxy = timeline.clips.find((clip) => clip.groupId === id)!;
    expect(proxy).toMatchObject({ start: 10, duration: 7 });
    expect(timeline.hidden.has(proxy.id)).toBe(false);
    expect(timeline.groups.get(proxy.id)?.members).toHaveLength(2);
    const scope = createGroupScope(project, id)!;
    expect(
      projectForGroup(project, scope).clips.map((clip) => clip.start),
    ).toEqual([10, 12]);
  });

  it("组内独立选中、移动、删除只写回当前组合，其他素材与主时间线标记保持原值", () => {
    const { project, id } = fixture();
    const scope = createGroupScope(project, id)!;
    const local = projectForGroup(project, scope);
    expect(selectionWithGroups(local, [local.clips[0].id])).toEqual([
      local.clips[0].id,
    ]);
    const moved = moveClips(local, [local.clips[1].id], 2);
    const edited = deleteClips(moved, [local.clips[0].id]);
    const merged = mergeGroupProject(project, scope, edited);
    expect(
      merged.clips.find((clip) => clip.id === local.clips[1].id),
    ).toMatchObject({ start: 14, groupId: id });
    expect(
      merged.clips.find((clip) => clip.id === local.clips[0].id),
    ).toBeUndefined();
    expect(merged.clips.find((clip) => clip.text === "组外")).toBe(
      project.clips[2],
    );
    expect(merged.markers).toBe(project.markers);
    expect(merged.assets).toBe(project.assets);
  });

  it("在组合内添加素材、轨道和标记后，工程保存重开仍能继续编辑", () => {
    const { project, id } = fixture();
    const scope = createGroupScope(project, id)!;
    const local = projectForGroup(project, scope);
    local.clips.push(newText("group-extra", 11, 0, "新文本"));
    local.tracks.push({
      id: "group-extra",
      name: "新轨道",
      hidden: false,
      muted: false,
      locked: false,
    });
    local.markers = [{ id: "group-marker", time: 11, label: "组内标记" }];
    const reopened = validateProject(
      JSON.parse(JSON.stringify(mergeGroupProject(project, scope, local))),
    );
    expect(reopened.clips.find((clip) => clip.text === "新文本")).toMatchObject(
      { start: 11, groupId: id },
    );
    expect(reopened.tracks.some((track) => track.id === "group-extra")).toBe(
      true,
    );
    expect(
      projectForGroup(reopened, createGroupScope(reopened, id)!).markers,
    ).toEqual(local.markers);
    expect(reopened.markers).toEqual(project.markers);
  });

  it("删除组内共享轨道时保留组外素材及其轨道", () => {
    const { project, id } = fixture();
    const scope = createGroupScope(project, id)!;
    const local = projectForGroup(project, scope);
    const edited = {
      ...local,
      tracks: local.tracks.filter((track) => track.id !== "titles"),
      clips: local.clips.filter((clip) => clip.trackId !== "titles"),
    };
    const merged = mergeGroupProject(project, scope, edited);
    expect(merged.tracks.some((track) => track.id === "titles")).toBe(true);
    expect(merged.clips.find((clip) => clip.text === "组外")).toEqual(
      project.clips[2],
    );
  });

  it("重命名保存为组合名称，不覆盖成员媒体名，空名称不写入", () => {
    const { project, id } = fixture();
    const renamed = renameClipGroup(project, id, "  开场组合  ");
    expect(groupName(validateProject(renamed), id)).toBe("开场组合");
    expect(renamed.clips).toBe(project.clips);
    expect(renameClipGroup(renamed, id, "  ")).toBe(renamed);
  });

  it("在组内创建子组合，返回主时间线后仍属于原组合，取消外层组合保留子组合", () => {
    const { project, id } = fixture();
    const scope = createGroupScope(project, id)!;
    const local = projectForGroup(project, scope);
    const nested = groupSelection(
      local,
      local.clips.map((clip) => clip.id),
    );
    const childId = nested.clips[0].groupId!;
    const merged = mergeGroupProject(project, scope, nested);
    expect(rootGroupId(merged, childId)).toBe(id);
    expect(groupMembers(merged, id)).toHaveLength(2);
    expect(groupedTimeline(merged).groups.size).toBe(1);
    const reopened = projectForGroup(merged, scope);
    expect(rootGroupId(reopened, childId)).toBe(childId);
    const released = groupSelection(merged, [merged.clips[0].id], true);
    expect(rootGroupId(released, childId)).toBe(childId);
    expect(groupMembers(released, childId)).toHaveLength(2);
  });

  it("复制组合保留名称和子组合关系，复制品独立编辑", () => {
    const { project, id } = fixture();
    const scope = createGroupScope(project, id)!;
    const local = projectForGroup(project, scope);
    const nested = groupSelection(
      local,
      local.clips.map((clip) => clip.id),
    );
    const merged = renameClipGroup(
      mergeGroupProject(project, scope, nested),
      id,
      "复用组合",
    );
    const pasted = pasteClips(merged, groupMembers(merged, id), 40).project;
    const copy = pasted.clips.find((clip) => clip.start === 40)!;
    const copiedRoot = rootGroupId(pasted, copy.groupId)!;
    expect(copiedRoot).not.toBe(id);
    expect(groupName(pasted, copiedRoot)).toBe("复用组合");
    expect(groupMembers(pasted, copiedRoot).map((clip) => clip.start)).toEqual([
      40, 42,
    ]);
    expect(validateProject(pasted).clips).toHaveLength(5);
  });
});
