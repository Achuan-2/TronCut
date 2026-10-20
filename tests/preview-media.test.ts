import { expect, it, vi } from "vitest";
import { newText, type Asset } from "../shared/model";
import {
  createPreviewMediaController,
  type PreviewMediaState,
} from "../src/preview-media";

class Media extends EventTarget {
  readyState = 0;
  duration = NaN;
  seeking = false;
  paused = true;
  playbackRate = 1;
  preservesPitch = true;
  volume = 1;
  muted = false;
  time = 0;
  seeks: number[] = [];
  get currentTime() {
    return this.time;
  }
  set currentTime(next: number) {
    this.time = next;
    this.seeks.push(next);
    this.seeking = true;
  }
  play = vi.fn(async () => {
    this.paused = false;
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  loaded() {
    this.readyState = 4;
    this.duration = 30;
    this.dispatchEvent(new Event("loadedmetadata"));
  }
  seeked() {
    this.seeking = false;
    this.dispatchEvent(new Event("seeked"));
  }
}
const state = (): PreviewMediaState => ({
  clip: { ...newText("video", 0), kind: "video", sourceIn: 8, speed: 1.2 },
  asset: { duration: 30 } as Asset,
  localTime: 0,
  playing: false,
  muted: true,
});
const controllerFor = (media: Media) =>
  createPreviewMediaController(media as unknown as HTMLMediaElement);

it("拖动光标的子帧位置共用同一预览帧，解码中只保留最新帧", () => {
  const media = new Media(),
    controller = controllerFor(media);
  const s = {
    ...state(),
    fps: 20,
    clip: { ...state().clip, sourceIn: 0, speed: 1 },
  };
  media.loaded();
  controller.update({ ...s, localTime: 3 });
  media.seeked();
  for (const localTime of [3.001, 3.006, 3.012, 3.024])
    controller.update({ ...s, localTime });
  expect(media.seeks).toEqual([3]);
  controller.update({ ...s, localTime: 3.026 });
  controller.update({ ...s, localTime: 3.081 });
  expect(media.seeks).toEqual([3, 3.05]);
  media.seeked();
  expect(media.seeks).toEqual([3, 3.05, 3.1]);
  controller.dispose();
});

it("高帧率逐帧定位不被暂停容差跳过，实际播放仍使用连续源时间", () => {
  const media = new Media(),
    controller = controllerFor(media);
  const s = {
    ...state(),
    fps: 120,
    clip: { ...state().clip, sourceIn: 0, speed: 1 },
  };
  media.loaded();
  controller.update({ ...s, localTime: 1 });
  media.seeked();
  controller.update({ ...s, localTime: 1 + 1 / 120 });
  expect(media.seeks.at(-1)).toBeCloseTo(1 + 1 / 120, 8);
  media.seeked();
  controller.update({
    ...s,
    playing: true,
    clip: { ...s.clip, id: "playing" },
    localTime: 1.234,
  });
  expect(media.seeks.at(-1)).toBe(1.234);
  controller.dispose();
});

it("帧定格播放时暂停解码器并静音，越过停留区间后恢复播放", async () => {
  const media = new Media();
  const controller = controllerFor(media);
  media.loaded();
  const s = state();
  s.playing = true;
  s.muted = false;
  s.clip = {
    ...s.clip,
    sourceIn: 0,
    speed: 1,
    duration: 4,
    stitch: [
      { sourceIn: 8, duration: 1 },
      { sourceIn: 9, duration: 2, freeze: true },
      { sourceIn: 9, duration: 1 },
    ],
  };
  controller.update(s);
  media.seeked();
  await Promise.resolve();
  await Promise.resolve();
  controller.update({ ...s, localTime: 1.5 });
  media.seeked();
  expect(media.paused).toBe(true);
  expect(media.muted).toBe(true);
  expect(media.currentTime).toBe(9);
  controller.update({ ...s, localTime: 2.5 });
  expect(media.currentTime).toBe(9);
  controller.update({ ...s, localTime: 3.5 });
  media.seeked();
  expect(media.paused).toBe(false);
  expect(media.muted).toBe(false);
  expect(media.currentTime).toBe(9.5);
  controller.dispose();
});

it("拆分后视频即使调整音量仍保持静音，独立音频正常发声", () => {
  const media = new Media(),
    controller = controllerFor(media),
    s = state();
  controller.update({
    ...s,
    muted: false,
    clip: { ...s.clip, audioDetached: true, volume: 1 },
  });
  expect(media.muted).toBe(true);
  controller.update({
    ...s,
    muted: false,
    clip: { ...s.clip, kind: "audio", audioDetached: undefined, volume: 0.6 },
  });
  expect(media.muted).toBe(false);
  expect(media.volume).toBe(0.6);
});

it("处理后的音轨仍应用手动音量和时间线淡入淡出", () => {
  const media = new Media(),
    controller = controllerFor(media);
  const s = {
    ...state(),
    muted: false,
    clip: {
      ...state().clip,
      kind: "audio" as const,
      speed: 1,
      volume: 0.8,
      duration: 4,
      fadeIn: 1,
      fadeOut: 1,
    },
  };
  controller.update({ ...s, localTime: 0.5 });
  expect(media.volume).toBeCloseTo(0.4);
  controller.update({ ...s, localTime: 1 });
  expect(media.volume).toBeCloseTo(0.8);
  controller.update({ ...s, localTime: 3.5 });
  expect(media.volume).toBeCloseTo(0.4);
  controller.dispose();
});

it("异步加载使用最新定位，并在解码器繁忙时合并连续 seek", () => {
  const media = new Media(),
    controller = controllerFor(media),
    s = state();
  controller.update(s);
  controller.update({ ...s, localTime: 2 });
  expect(media.seeks).toEqual([]);
  media.loaded();
  expect(media.seeks).toEqual([10.4]);
  controller.update({ ...s, localTime: 3 });
  controller.update({ ...s, localTime: 4 });
  expect(media.seeks).toHaveLength(1);
  media.seeked();
  expect(media.seeks).toEqual([10.4, 12.8]);
  controller.dispose();
});

it("加载打断的播放会重试，暂停与卸载不会被迟到事件重新启动", async () => {
  const media = new Media(),
    controller = controllerFor(media),
    s = { ...state(), playing: true };
  media.play.mockRejectedValueOnce(new Error("AbortError"));
  controller.update(s);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  media.loaded();
  expect(media.play).toHaveBeenCalledTimes(2);
  expect(media.playbackRate).toBe(1.2);
  controller.update({ ...s, playing: false });
  media.seeked();
  expect(media.paused).toBe(true);
  controller.dispose();
  media.dispatchEvent(new Event("canplay"));
  expect(media.play).toHaveBeenCalledTimes(2);
});

it("同素材剪切立即定位，循环素材按源时长取模", () => {
  const media = new Media(),
    controller = controllerFor(media),
    s = state();
  media.loaded();
  controller.update({ ...s, playing: true });
  media.seeked();
  controller.update({
    ...s,
    playing: true,
    clip: { ...s.clip, id: "cut", sourceIn: 8.1 },
  });
  expect(media.seeks.at(-1)).toBe(8.1);
  media.seeked();
  controller.update({
    ...s,
    clip: { ...s.clip, loop: true, sourceIn: 29 },
    localTime: 2,
  });
  expect(media.seeks.at(-1)).toBeCloseTo(1.4);
  controller.dispose();
});
