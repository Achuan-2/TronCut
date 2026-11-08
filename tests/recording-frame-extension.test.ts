import { describe, expect, it } from "vitest";
import {
  createProject,
  defaultTransform,
  newText,
  validateProject,
  type Asset,
} from "../shared/model";
import {
  addRecordedAssets,
  defaultRecordingSettings,
} from "../shared/recording";
import {
  recordingMaster,
  recordingTimeline,
} from "../shared/recording-objects";
import {
  frameExtensionError,
  frameExtensionTargetError,
  frameExtensions,
  setFrameExtension,
} from "../shared/frame-extension";
import { frozenAt, sourceTimeAt } from "../shared/media-segments";
import { transformAt } from "../shared/editor";
import { trimClip } from "../shared/clip-trim";
import { trimRecordingObject } from "../shared/recording-objects";
import { frameSnapshot } from "../shared/frame-snapshot";
import { setClipSpeed } from "../shared/clip-speed";

function fixture(dynamicBackground = false) {
  const source: Asset = {
    id: "screen",
    name: "录屏",
    path: "screen.mp4",
    kind: "video",
    duration: 6,
    width: 160,
    height: 90,
    hasAudio: true,
  };
  const project = addRecordedAssets(
    createProject(),
    [
      { asset: source, kind: "screen" },
      { asset: { ...source, id: "mic", kind: "audio" }, kind: "microphone" },
      { asset: { ...source, id: "camera" }, kind: "camera" },
    ],
    { ...defaultRecordingSettings, autoZoom: false, background: true },
    1,
    {
      ...source,
      id: "bg",
      kind: dynamicBackground ? "video" : "image",
      hasAudio: false,
    },
  );
  project.canvas.fps = 20;
  const screen = project.clips[0];
  screen.keyframes = [0, 2, 4, 6].map((time) => ({
    time,
    value: { ...screen.transform, contentScale: 1 + time / 6 },
    easing: "linear" as const,
    recordingZoom: true as const,
  }));
  const bg = project.clips.find((clip) => clip.assetId === "bg")!;
  bg.keyframes = screen.keyframes.map((frame) => ({
    ...frame,
    value: { ...defaultTransform, scale: 1 + frame.time / 6 },
  }));
  return project;
}

describe("录屏对象帧定格", () => {
  it.each(["playhead", "start", "end"] as const)(
    "%s 直接编辑录屏并同步音频、背景和镜头，调整移除可保存",
    (position) => {
      const project = fixture();
      const original = structuredClone(project);
      const screen = project.clips[0];
      const camera = project.clips.find((clip) => clip.assetId === "camera")!;
      const members = project.clips.filter(
        (clip) => clip.groupId === screen.groupId,
      );
      expect(frameExtensionTargetError(project, screen.id)).toBeNull();
      expect(
        frameExtensionError(project, screen.id, 1, 2, position),
      ).toBeNull();
      const at = position === "start" ? 0 : position === "end" ? 6 : 1;
      const result = setFrameExtension(project, screen.id, 1, 2, position);
      for (const member of members) {
        const next = result.clips.find((clip) => clip.id === member.id)!;
        expect(next.duration).toBe(8);
        expect(next.start).toBe(member.start);
        if (member.kind !== "image") {
          expect(frameExtensions(next)).toHaveLength(1);
          expect(frozenAt(next, at + 0.5)).toBe(true);
          expect(sourceTimeAt(next, at + 0.5)).toBeCloseTo(
            position === "end" ? 5.95 : at,
            8,
          );
          if (position !== "end")
            expect(sourceTimeAt(next, at + 2.5)).toBeCloseTo(at + 0.5, 8);
        }
        for (const time of [0, 0.5, 1, 1.95]) {
          expect(transformAt(next, at + time)).toEqual(
            transformAt(member, position === "end" ? 5.95 : at),
          );
        }
        if (position !== "end")
          expect(transformAt(next, at + 2.5)).toEqual(
            transformAt(member, at + 0.5),
          );
      }
      expect(result.clips.find((clip) => clip.id === camera.id)).toBe(camera);
      expect(recordingTimeline(result).clips).toHaveLength(2);
      expect(recordingMaster(result, screen.id)?.id).toBe(screen.id);
      expect(() =>
        validateProject(JSON.parse(JSON.stringify(result))),
      ).not.toThrow();
      const adjusted = setFrameExtension(result, screen.id, at, 3);
      expect(adjusted.clips[0].duration).toBe(9);
      const removed = setFrameExtension(adjusted, screen.id, at, 0);
      for (const member of members) {
        const next = removed.clips.find((clip) => clip.id === member.id)!;
        expect(next.duration).toBe(6);
        expect(next.stitch).toBeUndefined();
        for (const time of [0, 0.5, 1.5, 3, 5]) {
          expect(transformAt(next, time)).toEqual(transformAt(member, time));
        }
      }
      expect(() => validateProject(removed)).not.toThrow();
      expect(project).toEqual(original);
    },
  );

  it("各内部轨道的后续片段及其组合整体顺延，独立摄像头和其他轨道不变", () => {
    const project = fixture();
    const screen = project.clips[0];
    const members = project.clips.filter(
      (clip) => clip.groupId === screen.groupId,
    );
    project.clips.push(
      ...members.map((clip) => ({
        ...clip,
        id: `later-${clip.id}`,
        groupId: "following",
        start: 7,
        duration: 1,
        sourceIn: 0,
        keyframes: [],
      })),
      {
        ...newText("titles", 7),
        id: "title",
        groupId: "following",
        duration: 1,
      },
    );
    const result = setFrameExtension(project, screen.id, 1, 2);
    expect(
      result.clips
        .filter((clip) => clip.groupId === "following")
        .map((clip) => clip.start),
    ).toEqual([9, 9, 9, 9]);
    expect(result.clips.find((clip) => clip.assetId === "camera")).toBe(
      project.clips[2],
    );
    const removed = setFrameExtension(result, screen.id, 1, 0);
    expect(
      removed.clips
        .filter((clip) => clip.groupId === "following")
        .every((clip) => clip.start === 7),
    ).toBe(true);
    expect(() => validateProject(result)).not.toThrow();
  });

  it("短麦克风音轨仅在覆盖定格位置时插入静音，动态背景继续循环且镜头同步停留", () => {
    const project = fixture(true);
    const screen = project.clips[0];
    const mic = project.clips.find((clip) => clip.assetId === "mic")!;
    mic.duration = 2;
    const afterMic = setFrameExtension(project, screen.id, 3, 2);
    expect(afterMic.clips.find((clip) => clip.id === mic.id)).toBe(mic);
    const result = setFrameExtension(project, screen.id, 1, 2);
    const nextMic = result.clips.find((clip) => clip.id === mic.id)!;
    expect(nextMic.duration).toBe(4);
    expect(frozenAt(nextMic, 2)).toBe(true);
    expect(sourceTimeAt(nextMic, 3.5)).toBe(1.5);
    const bg = result.clips.find((clip) => clip.assetId === "bg")!;
    expect(bg).toMatchObject({ loop: true, duration: 8 });
    expect(bg.stitch).toBeUndefined();
    expect(transformAt(bg, 1.2)).toEqual(transformAt(bg, 2.8));
    expect(() => validateProject(result)).not.toThrow();
  });

  it("裁剪后的录屏保留各自源时间及动画偏移，单帧截取使用定格画面", () => {
    let project = fixture();
    const screen = project.clips[0];
    project = trimRecordingObject(
      project,
      screen,
      trimClip(screen, project.assets[0], "left", 1, 20),
    );
    const trimmed = project.clips[0];
    const result = setFrameExtension(project, trimmed.id, 1, 2);
    expect(sourceTimeAt(result.clips[0], 2)).toBe(2);
    expect(transformAt(result.clips[0], 2)).toEqual(transformAt(trimmed, 1));
    expect(transformAt(result.clips[0], 4)).toEqual(transformAt(trimmed, 2));
    expect(
      frameSnapshot(result, trimmed.start + 2).clips.find(
        (clip) => clip.id === trimmed.id,
      )?.sourceIn,
    ).toBe(2);
    expect(() => validateProject(result)).not.toThrow();
  });

  it("录屏主画面变速、音轨错开起点及多个定格仍按时间线秒数同步", () => {
    const project = fixture();
    project.clips[0] = setClipSpeed(project.clips[0], 2);
    const screen = project.clips[0];
    const mic = project.clips.find((clip) => clip.assetId === "mic")!;
    mic.start += 0.5;
    mic.sourceIn = 0.5;
    mic.duration = 2.5;
    const first = setFrameExtension(project, screen.id, 1, 2);
    expect(sourceTimeAt(first.clips[0], 2)).toBe(2);
    const nextMic = first.clips.find((clip) => clip.id === mic.id)!;
    expect(sourceTimeAt(nextMic, 1.5)).toBe(1);
    expect(sourceTimeAt(nextMic, 3.5)).toBe(2);
    const second = setFrameExtension(first, screen.id, 4, 1);
    expect(frameExtensions(second.clips[0])).toHaveLength(2);
    expect(sourceTimeAt(second.clips[0], 4.5)).toBe(4);
    expect(() => validateProject(second)).not.toThrow();
    const removed = setFrameExtension(
      setFrameExtension(second, screen.id, 4, 0),
      screen.id,
      1,
      0,
    );
    expect(removed.clips[0].duration).toBe(3);
    expect(removed.clips[0].stitch).toBeUndefined();
    expect(removed.clips.find((clip) => clip.id === mic.id)).toMatchObject({
      start: mic.start,
      duration: mic.duration,
      sourceIn: mic.sourceIn,
      stitch: undefined,
    });
  });

  it("内部离线或锁定、后续组合锁定及跨轨冲突均完整拒绝操作，普通组合仍需打开组", () => {
    for (const kind of [
      "lock",
      "offline",
      "following-lock",
      "collision",
      "ordinary",
    ] as const) {
      const project = fixture();
      const screen = project.clips[0];
      const mic = project.clips.find((clip) => clip.assetId === "mic")!;
      if (kind === "lock")
        project.tracks.find((track) => track.id === mic.trackId)!.locked = true;
      if (kind === "offline")
        project.assets.find((asset) => asset.id === "mic")!.missing = true;
      if (kind === "ordinary") screen.recording = undefined;
      if (kind === "following-lock") {
        project.clips.push(
          { ...newText(mic.trackId, 7), duration: 1, groupId: "following" },
          { ...newText("titles", 7), duration: 1, groupId: "following" },
        );
        project.tracks.find((track) => track.id === "titles")!.locked = true;
      }
      if (kind === "collision")
        project.clips.push(
          { ...newText(mic.trackId, 0), duration: 0.5, groupId: "following" },
          { ...newText(mic.trackId, 7), duration: 1, groupId: "following" },
        );
      expect(frameExtensionError(project, screen.id, 1, 2), kind).toBeTruthy();
      expect(setFrameExtension(project, screen.id, 1, 2), kind).toBe(project);
    }
  });
});
