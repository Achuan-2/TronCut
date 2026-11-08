import { describe, expect, it } from "vitest";
import { createProject, newText, type Asset } from "../shared/model";
import {
  addRecordedAssets,
  defaultRecordingSettings,
} from "../shared/recording";
import { trimTimelineClip } from "../shared/timeline-trim";

const video: Asset = {
  id: "source",
  name: "录屏",
  path: "screen.mp4",
  kind: "video",
  duration: 18.2,
  width: 160,
  height: 90,
  hasAudio: true,
};

describe("跨轨道裁边吸附", () => {
  it.each(["left", "right"] as const)(
    "%s 边可吸附到另一轨道的起点或终点",
    (edge) => {
      const project = createProject();
      const clip = { ...newText("video", 4), duration: 4 };
      const target = { ...newText("titles", 5), duration: 2 };
      project.clips = [clip, target];
      for (const time of [5, 7]) {
        const delta =
          time +
          0.05 -
          (edge === "left" ? clip.start : clip.start + clip.duration);
        const result = trimTimelineClip(
          project,
          clip,
          undefined,
          edge,
          delta,
          0.1,
        );
        expect(
          edge === "left" ? result.start : result.start + result.duration,
        ).toBeCloseTo(time);
        const free = trimTimelineClip(project, clip, undefined, edge, delta);
        expect(
          edge === "left" ? free.start : free.start + free.duration,
        ).toBeCloseTo(time + 0.05);
      }
    },
  );

  it("超出像素容差时不吸附，缩放后仍使用同样的屏幕距离", () => {
    const project = createProject();
    const clip = { ...newText("video", 2), duration: 4 };
    project.clips = [clip, { ...newText("titles", 8), duration: 2 }];
    for (const zoom of [40, 160]) {
      expect(
        trimTimelineClip(
          project,
          clip,
          undefined,
          "right",
          2 - 6 / zoom,
          8 / zoom,
        ).duration,
      ).toBe(6);
      expect(
        trimTimelineClip(
          project,
          clip,
          undefined,
          "right",
          2 - 12 / zoom,
          8 / zoom,
        ).duration,
      ).toBeCloseTo(6 - 12 / zoom);
    }
  });

  it("变速视频先限制源长度，再吸附到附近可达边缘", () => {
    const project = createProject();
    const clip = {
      ...newText("video", 0),
      kind: "video" as const,
      assetId: video.id,
      speed: 1.82,
      duration: 8,
    };
    project.clips = [
      clip,
      { ...newText("titles", 9.95), duration: 2 },
      { ...newText("audio", 10.02), duration: 2 },
    ];
    const result = trimTimelineClip(project, clip, video, "right", 3, 0.1);
    expect(result.duration).toBeCloseTo(9.95);
    expect(result.duration * result.speed).toBeLessThanOrEqual(video.duration);
  });

  it("同轨相邻素材继续限制裁剪", () => {
    const project = createProject();
    const clip = { ...newText("video", 0), duration: 8 };
    project.clips = [
      clip,
      { ...newText("video", 10), duration: 2 },
      { ...newText("titles", 10.02), duration: 2 },
    ];
    expect(
      trimTimelineClip(project, clip, undefined, "right", 1.99, 0.1).duration,
    ).toBe(10);
    expect(
      trimTimelineClip(project, clip, undefined, "right", 4, 0.1).duration,
    ).toBe(10);
  });

  it("左边缘先限制源起点，再吸附到附近可达边缘", () => {
    const project = createProject();
    const clip = {
      ...newText("video", 4),
      kind: "video" as const,
      assetId: video.id,
      sourceIn: 1.82,
      speed: 1.82,
      duration: 4,
    };
    project.clips = [clip, { ...newText("titles", 3.05), duration: 2 }];
    const result = trimTimelineClip(project, clip, video, "left", -2, 0.1);
    expect(result.start).toBeCloseTo(3.05);
    expect(result.sourceIn).toBeGreaterThanOrEqual(0);
    expect(result.start + result.duration).toBeCloseTo(8);
  });

  it("不可达的最短帧内边缘不遮挡附近的可达目标", () => {
    const project = createProject();
    project.canvas.fps = 30;
    const clip = { ...newText("video", 4), duration: 4 };
    project.clips = [
      clip,
      { ...newText("titles", 7.99), duration: 2 },
      { ...newText("audio", 7.94), duration: 2 },
    ];
    const result = trimTimelineClip(
      project,
      clip,
      undefined,
      "left",
      3.98,
      0.1,
    );
    expect(result.start).toBeCloseTo(7.94);
    expect(result.duration).toBeGreaterThanOrEqual(1 / project.canvas.fps);
  });

  it("录屏裁边不被同步移动的隐藏麦克风和背景边缘吸回原位", () => {
    const project = addRecordedAssets(
      createProject(),
      [
        { asset: video, kind: "screen" },
        { asset: { ...video, id: "mic", kind: "audio" }, kind: "microphone" },
      ],
      { ...defaultRecordingSettings, autoZoom: false },
      0,
      { ...video, id: "background", kind: "image" },
    );
    const clip = project.clips[0];
    project.clips.push({
      ...newText("titles", video.duration - 0.06),
      duration: 2,
    });
    const result = trimTimelineClip(project, clip, video, "right", -0.02, 0.1);
    expect(result.duration).toBeCloseTo(video.duration - 0.06);
  });
});
