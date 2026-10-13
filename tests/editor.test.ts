import { describe, expect, it } from "vitest";
import { createProject, newText, validateProject } from "../shared/model";
import {
  animation,
  changeSpeed,
  setTransform,
  snapTime,
  splitClip,
  transformAt,
  addMediaAssets,
} from "../shared/editor";
import { parseSrt, toSrt } from "../shared/subtitles";
import { audioFilters, expression } from "../electron/export";

describe("编辑操作保留素材和动画时间", () => {
  it("双击视频优先画面轨，重复加入时避开已占用的文本和媒体区间", () => {
    const p = createProject();
    p.clips = [newText("titles", 0)];
    const asset = {
      id: "v",
      name: "video.mp4",
      path: "media/video.mp4",
      kind: "video" as const,
      duration: 2,
      width: 320,
      height: 180,
      hasAudio: true,
    };
    const first = addMediaAssets(p, [asset], 1, true),
      second = addMediaAssets(first, [asset], 1, true);
    expect(first.clips[1].trackId).toBe("video");
    expect(second.assets).toHaveLength(1);
    expect(second.clips[2].trackId).not.toBe(first.clips[1].trackId);
    expect(second.clips[2].trackId).not.toBe("titles");
  });
  it("拆分加速片段后，右片段从正确的源时间开始", () => {
    const p = createProject(),
      c = newText("video", 3);
    c.duration = 10;
    c.sourceIn = 2;
    c.speed = 2;
    p.clips = [c];
    const result = splitClip(p, c.id, 7);
    expect(result.clips.map((c) => c.duration)).toEqual([4, 6]);
    expect(result.clips[1].sourceIn).toBe(10);
    expect(splitClip(p, c.id, 3)).toBe(p);
  });
  it("拆分关键帧时保持拆分点与后续插值一致", () => {
    const p = createProject(),
      c = animation(newText("titles", 0), "slide", 0);
    p.clips = [c];
    const at = transformAt(c, 0.3),
      split = splitClip(p, c.id, 0.3);
    expect(transformAt(split.clips[0], 0.3)).toEqual(at);
    expect(transformAt(split.clips[1], 0)).toEqual(at);
    for (const t of [0.01, 0.1, 0.2, 0.29]) {
      expect(transformAt(split.clips[0], t).x).toBeCloseTo(
        transformAt(c, t).x,
        10,
      );
      expect(transformAt(split.clips[1], t).x).toBeCloseTo(
        transformAt(c, t + 0.3).x,
        10,
      );
    }
  });
  it("自动动画保持原始关键帧，并覆盖同一时刻的值", () => {
    const c = newText("titles", 0),
      moved = setTransform(c, { x: 0.8 }, 2, true),
      movedAgain = setTransform(moved, { y: 0.2 }, 2, true);
    expect(movedAgain.keyframes).toHaveLength(2);
    expect(transformAt(movedAgain, 0)).toEqual(c.transform);
    expect(transformAt(movedAgain, 2)).toMatchObject({ x: 0.8, y: 0.2 });
    expect(transformAt(movedAgain, 1).x).toBeCloseTo(0.65);
    expect(expression(movedAgain, "x")).toContain("clip(");
  });
  it("变速不改变消耗的源素材长度，并同步关键帧", () => {
    const c = animation(newText("titles", 0), "zoom", 0),
      fast = changeSpeed(c, 2);
    expect(fast.duration * fast.speed).toBe(c.duration * c.speed);
    expect(fast.keyframes[1].time).toBe(0.3);
  });
  it("吸附排除当前片段，保持非邻近时间", () => {
    const p = createProject(),
      c = newText("titles", 5);
    p.clips = [c];
    expect(snapTime(4.95, p)).toBe(5);
    expect(snapTime(4.95, p, c.id)).toBe(4.95);
  });
});
describe("字幕与工程校验", () => {
  it("中文多行字幕、BOM、CRLF 与小时级时间往返", () => {
    const cues = parseSrt(
      "\uFEFF1\r\n01:02:03,999 --> 01:02:05,001\r\n第一行\r\n第二行\r\n\r\n2\r\n00:00:01,000 --> 00:00:02,000\r\n你好",
    );
    expect(cues[0].start).toBeCloseTo(3723.999);
    expect(cues[0].text).toBe("第一行\n第二行");
    expect(parseSrt(toSrt(cues))).toEqual(
      [...cues].sort((a, b) => a.start - b.start),
    );
  });
  it("忽略无效字幕", () =>
    expect(parseSrt("1\n00:00:03,000 --> 00:00:02,000\n坏时间")).toEqual([]));
  it("拒绝重复 ID、悬空轨道和非法颜色", () => {
    const p = createProject();
    p.clips = [newText("missing", 0)];
    expect(() => validateProject(p)).toThrow("轨道");
    p.clips = [];
    p.assets = [
      {
        id: "a",
        name: "x",
        path: "media/x",
        kind: "image",
        duration: 1,
        width: 1,
        height: 1,
        hasAudio: false,
      },
      {
        id: "a",
        name: "y",
        path: "media/y",
        kind: "image",
        duration: 1,
        width: 1,
        height: 1,
        hasAudio: false,
      },
    ];
    expect(() => validateProject(p)).toThrow("重复");
    p.assets = [];
    p.canvas.background = "red;movie=secret";
    expect(() => validateProject(p)).toThrow();
  });
  it("拒绝可造成素材目录逃逸的 ID", () => {
    const p = createProject();
    p.id = "../../escape";
    expect(() => validateProject(p)).toThrow();
  });
  it("缺少 Rubber Band 时，将大倍率音频拆为 atempo 链", () => {
    const c = newText("audio", 0);
    c.speed = 8;
    expect(audioFilters(c, false)).toEqual([
      "atempo=2",
      "atempo=2",
      "atempo=2",
      "volume=1",
      "aresample=48000",
    ]);
    expect(audioFilters(c, true)[0]).toBe("rubberband=tempo=8:pitch=1");
  });
});
