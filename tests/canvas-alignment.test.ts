import { describe, expect, it } from "vitest";
import {
  createProject,
  newText,
  newTrack,
  validateProject,
  type Clip,
} from "../shared/model";
import {
  alignCanvasClips,
  canvasAlignmentTargets,
  type CanvasAlignment,
} from "../shared/canvas-alignment";
import { projectDelta } from "../shared/rotation";
import { transformAt } from "../shared/editor";
import { defaultRecordingSettings } from "../shared/recording-settings";

const size = (clip: Clip) => clip.textBox!;
function fixture() {
  const project = createProject();
  project.canvas = { ...project.canvas, width: 1000, height: 600 };
  project.clips = [newText("titles", 0), newText("video", 0)];
  project.clips[0].textBox = { width: 140, height: 90 };
  project.clips[0].transform = {
    ...project.clips[0].transform,
    x: 0.2,
    y: 0.3,
    scale: 0.8,
    rotation: 28,
    rotationX: 25,
    rotationY: -15,
    skew: 12,
    z: 100,
  };
  project.clips[1].textBox = { width: 240, height: 110 };
  project.clips[1].transform = {
    ...project.clips[1].transform,
    x: 0.75,
    y: 0.7,
    scaleX: 1.3,
    rotation: -35,
  };
  return project;
}
function bounds(clip: Clip, time = 0) {
  const pose = transformAt(clip, time - clip.start);
  const corners = [-1, 1].flatMap((x) =>
    [-1, 1].map((y) =>
      projectDelta(
        pose,
        {
          x: (x * size(clip).width * pose.scale) / 2,
          y: (y * size(clip).height * pose.scale) / 2,
        },
        clip.rotation,
      ),
    ),
  );
  const xs = corners.map((point) => point.x + pose.x * 1000);
  const ys = corners.map((point) => point.y + pose.y * 600);
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
}

describe("画布多选对齐", () => {
  it.each<CanvasAlignment>([
    "left",
    "center",
    "right",
    "top",
    "middle",
    "bottom",
  ])("%s 以所选外框为参照，保留另一轴和三维外观", (alignment) => {
    const project = fixture();
    const ids = project.clips.map((clip) => clip.id);
    const original = structuredClone(project);
    const before = project.clips.map((clip) => bounds(clip));
    const horizontal = ["left", "center", "right"].includes(alignment);
    const minKey = horizontal ? "left" : "top",
      maxKey = horizontal ? "right" : "bottom";
    const min = Math.min(...before.map((box) => box[minKey]));
    const max = Math.max(...before.map((box) => box[maxKey]));
    const target = ["left", "top"].includes(alignment)
      ? min
      : ["right", "bottom"].includes(alignment)
        ? max
        : (min + max) / 2;
    const next = alignCanvasClips(project, ids, alignment, 0, size);
    for (const [index, clip] of next.clips.entries()) {
      const box = bounds(clip);
      const edge =
        alignment === "center" || alignment === "middle"
          ? (box[minKey] + box[maxKey]) / 2
          : box[alignment as "left" | "right" | "top" | "bottom"];
      expect(edge).toBeCloseTo(target, 8);
      const axis = horizontal ? "x" : "y";
      const { [axis]: ignored, ...unchanged } = clip.transform;
      const { [axis]: previous, ...expected } = project.clips[index].transform;
      expect(unchanged).toEqual(expected);
      expect(clip.text).toBe(project.clips[index].text);
    }
    expect(project).toEqual(original);
    expect(validateProject(next)).toEqual(next);
    expect(
      alignCanvasClips(project, [...ids].reverse(), alignment, 0, size),
    ).toEqual(next);
    expect(alignCanvasClips(next, ids, alignment, 0, size)).toBe(next);
  });

  it("媒体按画布适配尺寸和裁剪后的可见外框对齐", () => {
    const project = fixture();
    const media = project.clips[1];
    media.kind = "image";
    media.assetId = "image";
    media.transform = { ...media.transform, rotation: 0, scaleX: 1 };
    media.crop = { left: 0.1, right: 0.2, top: 0, bottom: 0.25 };
    project.assets = [
      {
        id: "image",
        name: "图",
        path: "image.png",
        kind: "image",
        width: 2000,
        height: 1000,
        duration: 0,
        hasAudio: false,
      },
    ];
    const left = bounds(project.clips[0]).left;
    const next = alignCanvasClips(
      project,
      project.clips.map((clip) => clip.id),
      "left",
      0,
      size,
    );
    expect(next.clips[1].transform.x * 1000 - 700 / 2).toBeCloseTo(left);
    expect(next.clips[1].crop).toBe(media.crop);
  });

  it("音频、锁定、隐藏和不在播放头时间的对象不参与对齐", () => {
    const project = fixture();
    const candidates = ["audio", "locked", "hidden", "later", "ended"].map(
      (name) => {
        const track = newTrack(project.tracks.length);
        project.tracks.push({
          ...track,
          locked: name === "locked",
          hidden: name === "hidden",
        });
        const clip = newText(track.id, name === "later" ? 5 : 0);
        clip.textBox = { width: 100, height: 100 };
        if (name === "audio") clip.kind = "audio";
        if (name === "ended") clip.duration = 0.5;
        return clip;
      },
    );
    project.clips.push(...candidates);
    const ids = project.clips.map((clip) => clip.id);
    expect(
      canvasAlignmentTargets(project, ids, 1).map((clip) => clip.id),
    ).toEqual(ids.slice(0, 2));
    const next = alignCanvasClips(project, ids, "left", 1, size);
    candidates.forEach((clip) =>
      expect(next.clips.find((item) => item.id === clip.id)).toBe(clip),
    );
    expect(alignCanvasClips(project, [ids[0]], "left", 1, size)).toBe(project);
    project.tracks[0].solo = true;
    expect(canvasAlignmentTargets(project, ids, 1)).toHaveLength(1);
  });

  it("录屏组合只以主画面对齐，保留摄像头和音频的相对设置", () => {
    const project = fixture();
    const master = project.clips[0];
    master.kind = "video";
    master.recording = defaultRecordingSettings;
    master.recordingRole = "screen";
    master.groupId = "recording";
    const camera = {
      ...newText("audio", 0),
      kind: "video" as const,
      recordingRole: "camera" as const,
      groupId: master.groupId,
    };
    project.clips.push(camera);
    const ids = project.clips.map((clip) => clip.id);
    expect(
      canvasAlignmentTargets(project, ids, 0).map((clip) => clip.id),
    ).toEqual(ids.slice(0, 2));
    expect(alignCanvasClips(project, ids, "center", 0, size).clips[2]).toBe(
      camera,
    );
  });

  it("按当前动画姿态对齐，自动动画保留既有起点和另一轴运动", () => {
    const project = fixture();
    const clip = project.clips[1];
    clip.keyframes = [
      { time: 0, value: { ...clip.transform, x: 0.6, y: 0.2 } },
      {
        time: 2,
        value: { ...clip.transform, x: 0.9, y: 0.8 },
        animation: true,
      },
    ];
    const next = alignCanvasClips(
      project,
      project.clips.map((clip) => clip.id),
      "center",
      1,
      size,
      true,
      0.5,
    );
    const centers = next.clips.map((item) => {
      const box = bounds(item, 1);
      return (box.left + box.right) / 2;
    });
    expect(centers[0]).toBeCloseTo(centers[1], 8);
    expect(transformAt(next.clips[1], 0)).toEqual(transformAt(clip, 0));
    expect(transformAt(next.clips[1], 1).y).toBeCloseTo(transformAt(clip, 1).y);
    expect(
      next.clips[1].keyframes.find((frame) => frame.time === 2)?.value.y,
    ).toBe(0.8);
  });
});
