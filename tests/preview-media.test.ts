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
