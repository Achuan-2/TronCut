import { describe, expect, it } from "vitest";
import { animationDropTarget } from "../shared/animation-drag";
import { animationPresets } from "../shared/preset-library";
import { createProject, newText } from "../shared/model";
import { defaultRecordingSettings } from "../shared/recording-settings";

describe("自定义动画拖放", () => {
  it("只提供自定义动画，落点按项目帧率对齐并作为动画终点", () => {
    expect(animationPresets).toEqual([{ id: "custom", name: "自定义动画" }]);
    const project = createProject();
    project.canvas.fps = 30;
    const clip = newText("titles", 2);
    clip.animationOffset = 3;
    project.clips = [clip];
    const target = animationDropTarget(project, clip.id, 4.013, 1)!;
    expect(target.start).toBe(3);
    expect(target.end).toBe(4);
    expect(target.result.clip.keyframes.map((frame) => frame.time)).toEqual([
      4, 5,
    ]);
    expect(target.result.clip.keyframes[1].animation).toBe(true);
    expect(target.result.clip.keyframes[1].value).toEqual(clip.transform);
    expect(project.clips[0].keyframes).toEqual([]);
  });

  it("片头添加向后延伸，短片段不越界，重复落点复用原动画", () => {
    const project = createProject();
    const clip = newText("titles", 2);
    clip.duration = 0.3;
    project.clips = [clip];
    const target = animationDropTarget(project, clip.id, 2, 1)!;
    expect(target.start).toBe(2);
    expect(target.end).toBe(2.3);
    project.clips = [target.result.clip];
    expect(animationDropTarget(project, clip.id, 2.3, 1)?.result.clip).toBe(
      project.clips[0],
    );
  });

  it("拒绝锁定、隐藏、音频及片段以外的时间", () => {
    const project = createProject();
    const clip = newText("titles", 2);
    project.clips = [clip];
    for (const time of [1, 8, NaN, Infinity])
      expect(animationDropTarget(project, clip.id, time, 1)).toBeNull();
    project.tracks[0].locked = true;
    expect(animationDropTarget(project, clip.id, 3, 1)).toBeNull();
    project.tracks[0].locked = false;
    project.tracks[0].hidden = true;
    expect(animationDropTarget(project, clip.id, 3, 1)).toBeNull();
    project.tracks[0].hidden = false;
    clip.kind = "audio";
    expect(animationDropTarget(project, clip.id, 3, 1)).toBeNull();
  });

  it("命中录屏子对象时编辑主画面，子轨锁定后拒绝整个对象", () => {
    const project = createProject();
    const master = {
      ...newText("video", 0),
      recording: defaultRecordingSettings,
      recordingRole: "screen" as const,
      groupId: "recording",
    };
    const camera = {
      ...newText("titles", 0),
      recordingRole: "camera" as const,
      groupId: "recording",
    };
    project.clips = [master, camera];
    expect(animationDropTarget(project, camera.id, 3, 1)?.clipId).toBe(
      master.id,
    );
    project.tracks.find((track) => track.id === "titles")!.locked = true;
    expect(animationDropTarget(project, master.id, 3, 1)).toBeNull();
  });
});
