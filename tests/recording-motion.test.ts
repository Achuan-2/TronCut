import { expect, it } from "vitest";
import {
  defaultTransform,
  createProject,
  validateProject,
  type Clip,
} from "../shared/model";
import { recordingCameraFrames } from "../shared/recording-camera";
import { animationRanges, retimeAnimation } from "../shared/animation-ranges";
import { transformAt, splitClip } from "../shared/editor";
import {
  snapshotAnimation,
  pasteAnimation,
  removeAnimation,
} from "../shared/animation-edit";

function legacyRecording(): Clip {
  return {
    id: "screen",
    trackId: "video",
    kind: "video",
    name: "录屏",
    start: 0,
    sourceIn: 0,
    speed: 1,
    duration: 20,
    volume: 1,
    podcast: false,
    transform: defaultTransform,
    keyframes: [
      [0, 1, 0, 0],
      [12, 1.0003, 0, 1],
      [12.1, 1.2, 0, 1],
      [12.5, 2, 0, 1],
      [13, 2, 0, 2],
      [13.2, 2, -0.2, 2],
      [13.4, 2, -0.4, 2],
      [14, 2, -0.4, 2],
      [14.2, 2, 0, 2],
      [14.4, 2, 0.4, 2],
      [15, 2, 0.4, 2],
      [15.2, 1.5, 0.2, 2],
      [15.5, 1, 0, 2],
      [20, 1, 0, 0],
    ].map(([time, scale, x, segment]) => ({
      time,
      value: {
        ...defaultTransform,
        contentScale: scale,
        contentX: x,
        contentY: 0,
      },
      recordingZoom: true,
      ...(segment ? { recordingSegment: segment } : {}),
      easing: "linear",
    })),
  };
}

it("旧录屏按实际缩放、停顿和反向平移显示四段箭头，读取不重写镜头", () => {
  const clip = legacyRecording(),
    original = structuredClone(clip);
  expect(
    animationRanges(clip).map(({ start, end, motion }) => [start, end, motion]),
  ).toEqual([
    [12, 12.5, "zoom-in"],
    [13, 13.4, "pan"],
    [14, 14.4, "pan"],
    [15, 15.5, "zoom-out"],
  ]);
  expect(clip).toEqual(original);
  const project = validateProject({
    ...createProject(),
    assets: [{ id: "screen", path: "screen.mp4", name: "录屏", kind: "video", width: 1920, height: 1080, duration: 20, hasAudio: false }],
    clips: [{ ...clip, assetId: "screen" }],
  });
  const right = splitClip(project, clip.id, 13.1).clips[1];
  expect(animationRanges(right)[0]).toMatchObject({
    start: 0,
    hasStart: false,
    motion: "pan",
  });
  expect(animationRanges(right)[0].end).toBeCloseTo(0.3);
  for (const time of [0, 0.5, 2, 4])
    expect(transformAt(right, time)).toEqual(transformAt(clip, time + 13.1));
});

it("左右平移箭头可分别复制、移除和调节时间，不影响前半段静止或另一段镜头", () => {
  const clip = legacyRecording(),
    range = animationRanges(clip)[1];
  const copied = snapshotAnimation(clip, range)!;
  const pasted = pasteAnimation({ ...clip, keyframes: [] }, copied, 2);
  expect(animationRanges(pasted)).toHaveLength(1);
  expect(transformAt(pasted, 2.2).contentX).toBeCloseTo(-0.2);
  const removed = removeAnimation(clip, range);
  expect(animationRanges(removed).some((r) => r.start === 13)).toBe(false);
  expect(transformAt(removed, 14.4).contentX).toBeCloseTo(0.4);
  const retimed = retimeAnimation(clip, range, "end", 0.2, 30);
  expect(animationRanges(retimed)[1].end).toBeCloseTo(13.6);
  expect(transformAt(retimed, 4)).toEqual(transformAt(clip, 4));
  expect(transformAt(retimed, 14.4)).toEqual(transformAt(clip, 14.4));
});

it("新录屏保留长静止段的边界，左右跟随分别成段且内部采样不变成逐帧箭头", () => {
  const clip = legacyRecording();
  clip.duration = 22;
  const asset = {
    id: "screen",
    path: "screen.mp4",
    name: "录屏",
    kind: "video" as const,
    width: 1920,
    height: 1080,
    duration: 22,
    hasAudio: false,
    cursor: {
      samples: [
        { time: 12, x: 0.2, y: 0.5, click: true, visible: true },
        { time: 13, x: 0.2, y: 0.5, click: false, visible: true },
        { time: 14, x: 0.8, y: 0.5, click: true, visible: true },
        { time: 15, x: 0.2, y: 0.5, click: false, visible: true },
      ],
    },
  };
  clip.keyframes = recordingCameraFrames(asset, clip, 2);
  const ranges = animationRanges(clip);
  expect(ranges[0].start).toBeGreaterThan(11);
  for (const time of [0, 4, 8, 11]) {
    expect(transformAt(clip, time)).toMatchObject({
      contentScale: 1,
      contentX: 0,
      contentY: 0,
    });
    expect(ranges.some((r) => r.start < time && r.end > time)).toBe(false);
  }
  const pans = ranges.filter((r) => r.motion === "pan");
  expect(pans).toHaveLength(2);
  expect(transformAt(clip, pans[0].end).contentX).toBeLessThan(
    transformAt(clip, pans[0].start).contentX!,
  );
  expect(transformAt(clip, pans[1].end).contentX).toBeGreaterThan(
    transformAt(clip, pans[1].start).contentX!,
  );
  expect(ranges).toHaveLength(4);
  expect(clip.keyframes.length).toBeGreaterThan(50);
});
