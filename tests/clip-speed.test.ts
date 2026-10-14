import { describe, expect, it } from "vitest";
import {
  createProject,
  defaultTransform,
  newText,
  validateProject,
  type Clip,
} from "../shared/model";
import { splitClip, transformAt } from "../shared/editor";
import {
  addClipSpeed,
  durationParts,
  hasClipSpeed,
  removeClipSpeed,
  setClipSpeed,
  setSpeedDuration,
} from "../shared/clip-speed";
import { parseAnnotation } from "../shared/annotations";

const video = (): Clip => ({
  ...newText("video", 3),
  kind: "video",
  assetId: "asset",
  sourceIn: 2,
  duration: 8,
  animationOffset: 1,
  fadeIn: 1,
  fadeOut: 2,
  keyframes: [
    { time: 0, value: defaultTransform },
    {
      time: 4,
      value: { ...defaultTransform, x: 0.8, contentScale: 2, cropLeft: 0.2 },
      easing: "linear",
    },
    { time: 9, value: { ...defaultTransform, x: 0.3 }, easing: "bounce" },
  ],
});

describe("剪辑速度效果", () => {
  it("添加1倍速效果不改源区间，修改倍速联动时长并保持动画、裁剪与淡入淡出的源时序", () => {
    const original = video(),
      saved = JSON.stringify(original);
    const added = addClipSpeed(original);
    expect(hasClipSpeed(added)).toBe(true);
    expect(added.speed).toBe(1);
    const fast = setClipSpeed(added, 2);
    expect(fast).toMatchObject({
      start: 3,
      sourceIn: 2,
      speed: 2,
      duration: 4,
      animationOffset: 0.5,
      fadeIn: 0.5,
      fadeOut: 1,
      speedEffect: true,
    });
    expect(fast.keyframes.map((frame) => frame.time)).toEqual([0, 2, 4.5]);
    for (const time of [0, 0.5, 1.5, 3.9]) {
      expect(transformAt(fast, time)).toEqual(transformAt(original, time * 2));
      expect(fast.sourceIn + time * fast.speed).toBe(
        original.sourceIn + time * 2,
      );
    }
    expect(JSON.stringify(original)).toBe(saved);
    expect(setClipSpeed(fast, 1)).toMatchObject({
      duration: 8,
      fadeIn: 1,
      fadeOut: 2,
    });
  });
  it("持续时间反算倍速，限制非法倍率及超过可播放区间的拉伸", () => {
    const clip = video();
    expect(setSpeedDuration(clip, 4, 30)).toMatchObject({
      duration: 4,
      speed: 2,
    });
    expect(setSpeedDuration(clip, 16, 30)).toMatchObject({
      duration: 16,
      speed: 0.5,
    });
    expect(setSpeedDuration(clip, 1000, 30)).toMatchObject({
      duration: 32,
      speed: 0.25,
    });
    expect(setSpeedDuration(clip, 0.01, 30)).toMatchObject({
      duration: 1,
      speed: 8,
    });
    for (const value of [0, -1, NaN, Infinity, 9])
      expect(setClipSpeed(clip, value)).toBe(clip);
    expect(setSpeedDuration(clip, 0, 30)).toBe(clip);
    expect(addClipSpeed(newText("titles", 0)).speedEffect).toBeUndefined();
    expect(durationParts(59 + 29.9 / 30, 30)).toEqual({
      minutes: 1,
      seconds: 0,
      frames: 0,
    });
    expect(durationParts(4.5, 30)).toEqual({
      minutes: 0,
      seconds: 4,
      frames: 15,
    });
  });
  it("拆分后两段继承效果，移除一段恢复其实际源片段长度；旧变速与保存重开兼容", () => {
    const project = createProject();
    project.assets = [
      {
        id: "asset",
        path: "asset.mp4",
        name: "视频",
        kind: "video",
        duration: 20,
        width: 320,
        height: 180,
        hasAudio: true,
      },
    ];
    project.clips = [setClipSpeed(video(), 2)];
    const split = splitClip(project, project.clips[0].id, 5);
    expect(split.clips.map((clip) => clip.speedEffect)).toEqual([true, true]);
    expect(split.clips.map((clip) => clip.sourceIn)).toEqual([2, 6]);
    const normal = removeClipSpeed(split.clips[1]);
    expect(normal).toMatchObject({
      start: 5,
      sourceIn: 6,
      speed: 1,
      duration: 4,
    });
    expect(hasClipSpeed(normal)).toBe(false);
    expect(split.clips[0].speed).toBe(2);
    expect(hasClipSpeed({ ...video(), speed: 2 })).toBe(true);
    expect(
      validateProject(JSON.parse(JSON.stringify(split))).clips.every(
        hasClipSpeed,
      ),
    ).toBe(true);
  });
  it("标注拖放只接受已支持的模板，损坏或越界数据不进入编辑器", () => {
    expect(parseAnnotation('{"kind":"text","preset":0,"plain":true}')).toEqual({
      kind: "text",
      preset: 0,
      plain: true,
    });
    expect(parseAnnotation('{"kind":"shape","shape":"arrow"}')).toEqual({
      kind: "shape",
      shape: "arrow",
    });
    for (const data of [
      "bad",
      '{"kind":"text","preset":999}',
      '{"kind":"shape","shape":"unknown"}',
      "x".repeat(3000),
    ])
      expect(parseAnnotation(data)).toBeNull();
  });
});
