import { expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import {
  createProject,
  newText,
  projectDuration,
  validateProject,
  type Marker,
} from "../shared/model";
import {
  createMarker,
  dragMarker,
  markerEnd,
  markerTextColor,
  putMarker,
  removeMarker,
} from "../shared/markers";
import { deleteClips } from "../shared/timeline";
import { snapTime } from "../shared/editor";
import { openProject, saveProject } from "../electron/project-store";

it("自定义深色和浅色标记使用可读的文字颜色", () => {
  expect(markerTextColor("#000000")).toBe("#ffffff");
  expect(markerTextColor("#ffffff")).toBe("#142019");
  expect(markerTextColor("#ba94ea")).toBe("#142019");
});
it("兼容旧点标记，校验区域时长、颜色和备注", () => {
  const project = createProject();
  const legacy = { id: "old", time: 7, label: "旧标记" };
  project.markers = [legacy, createMarker(2, "片头", 3)];
  expect(validateProject(project).markers[0]).toEqual(legacy);
  expect(markerEnd(legacy)).toBe(7);
  expect(markerEnd(project.markers[1])).toBe(5);
  for (const patch of [
    { duration: -1 },
    { duration: 86401 },
    { color: "red" },
    { comments: "字".repeat(10001) },
  ]) {
    expect(() =>
      validateProject({
        ...project,
        markers: [{ ...project.markers[1], ...patch }],
      }),
    ).toThrow();
  }
});

it("标记新增、编辑和删除不影响片段，时间线标记不延长输出时长", () => {
  const project = createProject();
  project.clips = [newText("titles", 0)];
  const marker = createMarker(100, "待调整", 20);
  const added = putMarker(project, marker);
  const edited = {
    ...marker,
    comments: "缩短停顿\n补充说明",
    color: "#f47479",
  };
  const result = putMarker(added, edited);
  expect(result.markers).toEqual([edited]);
  expect(result.clips).toBe(project.clips);
  expect(projectDuration(result)).toBe(5);
  expect(putMarker(result, edited)).toBe(result);
  expect(removeMarker(result, "missing")).toBe(result);
  expect(removeMarker(result, marker.id).markers).toEqual([]);
  expect(project.markers).toEqual([]);
});

const range: Marker = {
  id: "range",
  time: 2,
  duration: 3,
  label: "镜头",
  comments: "检查音画同步",
  color: "#73a5f5",
};

it("片段吸附识别点标记和区域的两端，超出容差时不改变时间", () => {
  const project = createProject();
  project.markers = [range, { id: "point", time: 9, label: "点" }];
  expect(snapTime(1.95, project)).toBe(2);
  expect(snapTime(5.05, project)).toBe(5);
  expect(snapTime(8.95, project)).toBe(9);
  expect(snapTime(6, project)).toBe(6);
});

it("移动整段按帧对齐并限制负时间，长度、备注和颜色保持不变", () => {
  expect(dragMarker(range, "move", -100, 30)).toEqual({ ...range, time: 0 });
  expect(dragMarker(range, "move", 0.11, 30).time).toBeCloseTo(2.1);
  expect(
    dragMarker({ id: "point", time: 2, label: "点" }, "move", 1, 30),
  ).toEqual({ id: "point", time: 3, label: "点" });
});

it("调节两端保留对侧，限制至少一帧和最长 24 小时", () => {
  const start = dragMarker(range, "start", 1, 30);
  expect(start).toEqual({ ...range, time: 3, duration: 2 });
  expect(markerEnd(start)).toBe(5);
  const collapsed = dragMarker(range, "start", 100, 30);
  expect(collapsed.duration).toBeCloseTo(1 / 30);
  expect(markerEnd(collapsed)).toBe(5);
  expect(dragMarker(range, "end", -100, 30).duration).toBeCloseTo(1 / 30);
  expect(dragMarker(range, "end", 1, 30)).toEqual({ ...range, duration: 4 });
  expect(dragMarker(range, "end", 1000000, 30).duration).toBe(86400);
  expect(
    dragMarker({ ...range, time: 100000 }, "start", -1000000, 30).duration,
  ).toBe(86400);
});

it("波纹删除映射区域的两端，只缩短删除区间内的时长", () => {
  const project = createProject();
  const removed = { ...newText("titles", 3), duration: 2 };
  project.clips = [removed, newText("video", 8)];
  project.markers = [
    { ...range, time: 1, duration: 6 },
    { ...range, id: "after", time: 6, duration: 2 },
    { ...range, id: "inside", time: 3, duration: 2 },
    { id: "point", time: 7, label: "旧点" },
  ];
  const result = deleteClips(project, [removed.id], true);
  expect(
    result.markers.map((marker) => [marker.time, marker.duration]),
  ).toEqual([
    [1, 4],
    [4, 2],
    [3, 0],
    [5, undefined],
  ]);
  expect(result.markers[0]).toMatchObject({
    comments: range.comments,
    color: range.color,
  });
  expect(deleteClips(project, [removed.id]).markers).toBe(project.markers);
});

it("工程保存重开完整保留点标记、区域、颜色与多行备注", async () => {
  const root = path.resolve(`test-output/markers-${Date.now()}`);
  await fs.mkdir(root, { recursive: true });
  const project = createProject("标记持久化");
  project.markers = [range, { id: "old", time: 9, label: "旧标记" }];
  const file = path.join(root, "markers.troncut");
  await saveProject(project, file);
  expect((await openProject(file)).markers).toEqual(project.markers);
});
