import { describe, expect, it } from "vitest";
import { createProject, newText } from "../shared/model";
import { stepFrameTime, mediaBoundaryTime } from "../shared/playback";
import { createPlaybackStore } from "../src/playback-store";

describe("播放条定位", () => {
  it("独立播放时钟通知订阅者，并对相同时间保持无操作", () => {
    const playback = createPlaybackStore(1);
    let notifications = 0;
    const unsubscribe = playback.subscribe(() => notifications++);

    playback.set(2);
    playback.set((time) => time + 0.5);
    playback.set(2.5);
    expect(playback.getSnapshot()).toBe(2.5);
    expect(notifications).toBe(2);

    unsubscribe();
    playback.set(3);
    expect(playback.getSnapshot()).toBe(3);
    expect(notifications).toBe(2);
  });
  it("逐帧按项目帧率对齐，处理非整帧位置与浮点误差", () => {
    expect(stepFrameTime(1, 30, 1, 10)).toBeCloseTo(31 / 30);
    expect(stepFrameTime(1, 30, -1, 10)).toBeCloseTo(29 / 30);
    expect(stepFrameTime(1.01, 30, 1, 10)).toBeCloseTo(31 / 30);
    expect(stepFrameTime(1.01, 30, -1, 10)).toBe(1);
    expect(stepFrameTime(1 - 1e-12, 30, 1, 10)).toBeCloseTo(31 / 30);
    expect(stepFrameTime(1 + 1e-12, 30, -1, 10)).toBeCloseTo(29 / 30);
    expect(stepFrameTime(1.5, 24, 1, 10)).toBeCloseTo(37 / 24);
  });
  it("开头、末尾与非整帧时长不会越界，连续步进不会停在同一帧", () => {
    expect(stepFrameTime(0, 30, -1, 1)).toBe(0);
    expect(stepFrameTime(1, 30, 1, 1.01)).toBe(1.01);
    expect(stepFrameTime(1.01, 30, -1, 1.01)).toBe(1);
    expect(stepFrameTime(5, 30, -1, 1.01)).toBe(1);
    expect(stepFrameTime(0, 30, 1, 0)).toBe(0);
    let time = 0;
    for (let i = 0; i < 30; i++) time = stepFrameTime(time, 30, 1, 10);
    expect(time).toBe(1);
  });
  it("跨轨道按相邻片段起止定位，跳过当前边界与重复边界", () => {
    const p = createProject();
    const a = newText("titles", 0);
    a.duration = 2;
    const b = newText("video", 3);
    b.duration = 2;
    const c = newText("titles", 3);
    c.duration = 1;
    p.clips = [b, c, a];
    expect(mediaBoundaryTime(p, 1, -1)).toBe(0);
    expect(mediaBoundaryTime(p, 1, 1)).toBe(2);
    expect(mediaBoundaryTime(p, 2, 1)).toBe(3);
    expect(mediaBoundaryTime(p, 3, -1)).toBe(2);
    expect(mediaBoundaryTime(p, 3, 1)).toBe(4);
    expect(mediaBoundaryTime(p, 3 + 1e-12, 1)).toBe(4);
  });
  it("忽略隐藏轨道的中间边界，锁定轨道可正常导航，空工程仍可安全定位", () => {
    const p = createProject();
    const a = newText("video", 0);
    a.duration = 5;
    const b = newText("titles", 1);
    b.duration = 1;
    p.clips = [a, b];
    p.tracks.find((track) => track.id === "titles")!.hidden = true;
    p.tracks.find((track) => track.id === "video")!.locked = true;
    expect(mediaBoundaryTime(p, 0, 1)).toBe(5);
    expect(mediaBoundaryTime(p, 4, -1)).toBe(0);
    expect(mediaBoundaryTime(p, 0, -1)).toBe(0);
    expect(mediaBoundaryTime(p, 5, 1)).toBe(5);
    expect(mediaBoundaryTime(createProject(), 0, 1)).toBe(0);
  });
});
