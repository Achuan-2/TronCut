import { describe, expect, it } from "vitest";
import { createProject, newText, validateProject } from "../shared/model";
import {
  frameExtensionError,
  frameExtensions,
  setFrameExtension,
} from "../shared/frame-extension";
import {
  mediaSegments,
  sourceTimeAt,
  frozenAt,
} from "../shared/media-segments";
import { splitClip } from "../shared/editor";
import { setClipSpeed } from "../shared/clip-speed";
import { trimClip } from "../shared/clip-trim";
import { frameSnapshot } from "../shared/frame-snapshot";
import { waveformColumns, waveformLevels } from "../shared/audio-waveform";
import { requiredMediaDuration } from "../shared/media-library";
import { sourceCuesToTimeline } from "../electron/cli-project";

function fixture() {
  const project = createProject();
  project.canvas.fps = 20;
  project.assets = [
    {
      id: "asset",
      name: "video.mp4",
      path: "video.mp4",
      kind: "video",
      duration: 6,
      width: 160,
      height: 90,
      hasAudio: true,
    },
  ];
  project.clips = [
    {
      ...newText("video", 1),
      id: "video",
      kind: "video",
      assetId: "asset",
      sourceIn: 2,
      duration: 3,
    },
    {
      ...newText("video", 4),
      id: "later",
      kind: "video",
      assetId: "asset",
      sourceIn: 0,
      duration: 1,
    },
    { ...newText("titles", 4), id: "title", duration: 1 },
  ];
  return project;
}

describe("可编辑帧定格", () => {
  it("在当前帧插入停留，原素材继续接上，当前轨道后续片段顺延，移除还原", () => {
    const project = fixture();
    const original = structuredClone(project);
    const result = setFrameExtension(project, "video", 1, 2);
    const clip = result.clips[0];
    expect(clip.duration).toBe(5);
    expect(frameExtensions(clip)).toEqual([
      { sourceIn: 3, start: 1, duration: 2, freeze: true },
    ]);
    expect([0, 0.5, 1, 2.5, 3, 4, 5].map((t) => sourceTimeAt(clip, t))).toEqual(
      [2, 2.5, 3, 3, 3, 4, 5],
    );
    expect(result.clips[1].start).toBe(6);
    expect(result.clips[2]).toBe(project.clips[2]);
    expect(
      validateProject(JSON.parse(JSON.stringify(result))).clips[0].stitch,
    ).toEqual(clip.stitch);
    const longer = setFrameExtension(result, "video", 1, 3);
    expect(longer.clips[1].start).toBe(7);
    const removed = setFrameExtension(longer, "video", 1, 0);
    expect(removed.clips[0].duration).toBe(3);
    expect(removed.clips[0].stitch).toBeUndefined();
    expect([0, 1, 2, 3].map((t) => sourceTimeAt(removed.clips[0], t))).toEqual([
      2, 3, 4, 5,
    ]);
    expect(removed.clips[1].start).toBe(4);
    expect(project).toEqual(original);
    expect(setFrameExtension(result, "video", 1, 2)).toBe(result);
  });

  it("停留段裁剪、拆分、变速和单帧截取保持同一源帧", () => {
    const project = setFrameExtension(fixture(), "video", 1, 2);
    const clip = project.clips[0];
    const split = splitClip(project, "video", 3);
    const right = split.clips.find((clip) => clip.start === 3)!;
    expect(sourceTimeAt(right, 0.5)).toBe(3);
    expect(sourceTimeAt(right, 1.5)).toBe(3.5);
    const onlyFrozen = splitClip(split, right.id, 4).clips.find(
      (clip) => clip.id === right.id,
    )!;
    expect(onlyFrozen.stitch).toEqual([
      { sourceIn: 3, duration: 1, freeze: true },
    ]);
    expect(
      validateProject({ ...project, clips: [onlyFrozen] }).clips[0].stitch,
    ).toEqual(onlyFrozen.stitch);
    const trimmed = trimClip(clip, project.assets[0], "left", 2, 20);
    expect(sourceTimeAt(trimmed, 0.5)).toBe(3);
    const faster = setClipSpeed(clip, 2);
    expect(frameExtensions(faster)[0].duration).toBe(1);
    expect(frozenAt(faster, 0.75)).toBe(true);
    expect(sourceTimeAt(faster, 1)).toBe(3);
    expect(frameSnapshot(project, 3).clips[0].sourceIn).toBe(3);
    expect(requiredMediaDuration([clip])).toBe(5);
    expect(mediaSegments(onlyFrozen)[0].sourceIn).toBe(3);
  });

  it("停留区间波形为静音，不把源字幕重复映射到扩展区间", () => {
    const clip = setFrameExtension(fixture(), "video", 1, 2).clips[0];
    const waveform = {
      peaksPerSecond: 20,
      peaks: new Uint8Array(120).fill(100),
    };
    const columns = waveformColumns(
      waveform,
      waveformLevels(waveform.peaks),
      clip,
      6,
      20,
      0,
      100,
      1,
    );
    expect([...columns.slice(20, 60)].every((value) => value === 0)).toBe(true);
    expect(columns[10]).toBe(100);
    expect(columns[70]).toBe(100);
    expect(
      sourceCuesToTimeline([{ start: 2, end: 5, text: "台词" }], clip),
    ).toEqual([
      { start: 1, end: 2, text: "台词" },
      { start: 4, end: 6, text: "台词" },
    ]);
  });

  it("片头、片尾和已有拼接可插入多个帧定格，数据校验不会把停留时长当作源范围", () => {
    let project = fixture();
    project.clips[0].sourceIn = 5;
    project.clips[0].duration = 1;
    project = setFrameExtension(project, "video", 0, 10);
    expect(frameExtensions(project.clips[0])[0].sourceIn).toBe(5);
    expect(() => validateProject(project)).not.toThrow();
    project = setFrameExtension(project, "video", 10.95, 1);
    expect(frameExtensions(project.clips[0])).toHaveLength(2);
    expect(sourceTimeAt(project.clips[0], 11.5)).toBeCloseTo(5.95);
    expect(() => validateProject(project)).not.toThrow();
  });

  it("锁定、循环、离线、播放头越界和无效持续时间均不修改工程", () => {
    for (const mutate of [
      (p: ReturnType<typeof fixture>) => {
        p.tracks.find((t) => t.id === "video")!.locked = true;
      },
      (p: ReturnType<typeof fixture>) => {
        p.clips[0].loop = true;
      },
      (p: ReturnType<typeof fixture>) => {
        p.assets[0].missing = true;
      },
    ]) {
      const project = fixture();
      mutate(project);
      expect(frameExtensionError(project, "video", 1, 1)).toBeTruthy();
      expect(setFrameExtension(project, "video", 1, 1)).toBe(project);
    }
    const project = fixture();
    for (const [time, seconds] of [
      [-1, 1],
      [3, 1],
      [1, NaN],
      [1, 0],
      [1, 90000],
      [1, 0.001],
    ])
      expect(setFrameExtension(project, "video", time, seconds)).toBe(project);
  });
});
