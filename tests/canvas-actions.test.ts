import { describe, expect, it } from "vitest";
import {
  createProject,
  newText,
  newTrack,
  projectSchema,
} from "../shared/model";
import {
  arrangeClips,
  editableCanvasIds,
  fitFrameTransform,
  pasteClipProperties,
} from "../shared/canvas-actions";
import { defaultTransform } from "../shared/model";
import { defaultRecordingSettings } from "../shared/recording-settings";

describe("画布右键操作", () => {
  it("同轨对象排列只提取选中片段，保留时间和其他片段", () => {
    const project = createProject();
    const selected = newText("video", 0, 1, "选中");
    const other = newText("video", 4, 1, "同轨其他片段");
    project.clips = [selected, other];
    const next = arrangeClips(project, [selected.id], "top");
    expect(next.clips[1]).toBe(other);
    expect(next.clips[0].start).toBe(selected.start);
    expect(next.clips[0].trackId).toBe(next.tracks[0].id);
    expect(next.clips[0].trackId).not.toBe(selected.trackId);
    expect(projectSchema.safeParse(next).success).toBe(true);
  });

  it("上下移动只改变选中对象所在的层级，不交换其他轨道内容", () => {
    const project = createProject();
    project.tracks = [newTrack(0), newTrack(1), newTrack(2), newTrack(3)];
    project.clips = project.tracks.map((track, i) =>
      newText(track.id, 0, i, `对象${i}`),
    );
    const id = project.clips[1].id;
    const original = project.tracks.map((track) => track.id);
    for (const [direction, order] of [
      ["top", [1, 0, 2, 3]],
      ["up", [1, 0, 2, 3]],
      ["down", [0, 2, 1, 3]],
      ["bottom", [0, 2, 3, 1]],
    ] as const) {
      const next = arrangeClips(project, [id], direction);
      expect(next.tracks.map((track) => track.id)).toEqual(
        order.map((index) => original[index]),
      );
      expect(next.clips.map((clip) => clip.trackId)).toEqual(
        project.clips.map((clip) => clip.trackId),
      );
    }
    expect(arrangeClips(project, [project.clips[0].id], "up")).toBe(project);
  });

  it("多选排列保持相对顺序，锁定对象和轨道上限阻止修改", () => {
    const project = createProject();
    project.tracks = [newTrack(0), newTrack(1), newTrack(2)];
    project.clips = project.tracks.map((track, i) =>
      newText(track.id, 0, i, `对象${i}`),
    );
    const ids = project.clips.slice(1).map((clip) => clip.id);
    expect(
      arrangeClips(project, ids, "top").tracks.map((track) => track.id),
    ).toEqual([
      project.tracks[1].id,
      project.tracks[2].id,
      project.tracks[0].id,
    ]);
    project.tracks[1].locked = true;
    expect(arrangeClips(project, ids, "top")).toBe(project);
    project.tracks[1].locked = false;
    while (project.tracks.length < 128)
      project.tracks.push(newTrack(project.tracks.length));
    project.clips.push(newText(project.clips[1].trackId, 5, 0, "共享轨道"));
    expect(arrangeClips(project, ids, "top")).toBe(project);
  });

  it("置顶包含顶层的分散多选时，仍将其余选中对象移到顶层", () => {
    const project = createProject();
    project.clips = project.tracks.map((track, index) =>
      newText(track.id, 0, 0, `对象${index}`),
    );
    const ids = [project.clips[0].id, project.clips[2].id];
    const next = arrangeClips(project, ids, "top");
    expect(next.tracks.map((track) => track.id)).toEqual([
      project.tracks[0].id,
      project.tracks[2].id,
      project.tracks[1].id,
    ]);
  });

  it("录屏属性只作用于主画面，组合内任一锁定轨道阻止编辑", () => {
    const project = createProject();
    const master = {
      ...newText("video", 0, 0, "录屏"),
      kind: "video" as const,
      recording: defaultRecordingSettings,
      recordingRole: "screen" as const,
      groupId: "recording",
    };
    const camera = {
      ...newText("titles", 0, 0, "摄像头"),
      kind: "video" as const,
      recordingRole: "camera" as const,
      groupId: "recording",
    };
    const mic = {
      ...newText("audio", 0, 0, "麦克风"),
      kind: "audio" as const,
      recordingRole: "microphone" as const,
      groupId: "recording",
    };
    project.clips = [master, camera, mic];
    const ids = project.clips.map((clip) => clip.id);
    expect([...editableCanvasIds(project, ids)]).toEqual([master.id]);
    const source = newText("titles", 0, 0, "属性来源");
    source.transform.scale = 0.5;
    const next = pasteClipProperties(project, ids, source);
    expect(next.clips[0].transform.scale).toBe(0.5);
    expect(next.clips[1]).toBe(camera);
    expect(next.clips[2]).toBe(mic);
    project.tracks.find((track) => track.id === "audio")!.locked = true;
    expect([...editableCanvasIds(project, [master.id])]).toEqual([]);
    expect(pasteClipProperties(project, ids, source)).toBe(project);
  });

  it("粘贴属性保留目标内容、素材、分组与时间，清除旧外观且不共享对象", () => {
    const project = createProject();
    const source = newText("titles", 0, 0, "来源");
    const target = newText("video", 2, 0, "目标");
    source.transform.scale = 0.7;
    source.style!.color = "#123456";
    target.groupId = "target-group";
    target.effects = {
      brightness: 1,
      contrast: 1,
      saturation: 1,
      blur: 5,
      grayscale: false,
      flipX: false,
      flipY: false,
    };
    target.keyframes = [{ time: 0, value: { ...target.transform, scale: 2 } }];
    project.clips = [source, target];
    const next = pasteClipProperties(project, [target.id], source).clips[1];
    expect(next.text).toBe("目标");
    expect(next.start).toBe(2);
    expect(next.duration).toBe(target.duration);
    expect(next.groupId).toBe("target-group");
    expect(next.effects).toBeUndefined();
    expect(next.style!.color).toBe("#123456");
    expect(next.style).not.toBe(source.style);
    expect(next.transform.scale).toBe(0.7);
    expect(next.keyframes).toEqual([]);
    project.tracks.find((track) => track.id === "video")!.locked = true;
    expect(pasteClipProperties(project, [target.id], source)).toBe(project);
    expect(
      projectSchema.safeParse({ ...project, clips: [source, next] }).success,
    ).toBe(true);
  });

  it("自适应按旋转和缩放后的边界等比适配画布，保持其他属性", () => {
    expect(
      fitFrameTransform(
        defaultTransform,
        { width: 600, height: 300 },
        { width: 1920, height: 1080 },
      ),
    ).toEqual({ x: 0.5, y: 0.5, scale: 3.2 });
    const fit = fitFrameTransform(
      { ...defaultTransform, rotation: 90, z: 1000 },
      { width: 600, height: 300 },
      { width: 1920, height: 1080 },
    );
    expect(fit.scale).toBeCloseTo(0.9);
    expect(fit.x).toBe(0.5);
  });
});
