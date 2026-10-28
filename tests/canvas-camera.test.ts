import { expect, it } from "vitest";
import { createProject, validateProject } from "../shared/model";
import { cameraAt } from "../shared/canvas";
import {
  addCanvasCameraAnimation,
  cameraAnimationClip,
  commitCameraAnimation,
  updateCanvasCamera,
} from "../shared/canvas-camera";
import { animationRanges, retimeAnimation } from "../shared/animation-ranges";
import { removeAnimation } from "../shared/animation-edit";

it("全局运镜不修改对象，独立调整时间、时长、删除并保存重开", () => {
  const project = createProject();
  project.clips = [
    {
      ...cameraAnimationClip(project),
      id: "shape",
      trackId: project.tracks[0].id,
      duration: 10,
    },
  ];
  project.tracks[0].locked = true;
  const added = addCanvasCameraAnimation(project, 4)!;
  expect(added.time).toBe(4);
  expect(animationRanges(cameraAnimationClip(added.project))).toHaveLength(1);
  const changed = updateCanvasCamera(added.project, { scale: 2, x: 0.6 }, 4);
  expect(changed.clips).toBe(project.clips);
  expect(cameraAt(changed, 2).scale).toBe(1);
  expect(cameraAt(changed, 3.5).scale).toBeCloseTo(1.5);
  expect(cameraAt(changed, 7).scale).toBe(2);
  const clip = cameraAnimationClip(changed);
  const range = animationRanges(clip)[0];
  expect([range.start, range.end]).toEqual([3, 4]);
  const moved = retimeAnimation(clip, range, "move", 2, 30);
  const saved = validateProject(
    JSON.parse(JSON.stringify(commitCameraAnimation(changed, moved))),
  );
  expect(cameraAt(saved, 4).scale).toBe(1);
  expect(cameraAt(saved, 6).scale).toBe(2);
  const movedRange = animationRanges(moved)[0];
  const stretched = retimeAnimation(moved, movedRange, "end", 1, 30);
  expect(animationRanges(stretched)[0].end).toBe(7);
  expect(
    animationRanges(removeAnimation(stretched, animationRanges(stretched)[0])),
  ).toEqual([]);
});

it("起始位置添加可编辑的运镜动画，无需选择视频", () => {
  const project = createProject();
  project.clips = [{ ...cameraAnimationClip(project), duration: 5 }];
  const result = addCanvasCameraAnimation(project, 0)!;
  expect(result.time).toBe(1);
  expect(animationRanges(cameraAnimationClip(result.project))[0].end).toBe(1);
  expect(
    updateCanvasCamera(result.project, { scale: 3 }, result.time).clips,
  ).toBe(project.clips);
});
