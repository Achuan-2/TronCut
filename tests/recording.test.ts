import { expect, it } from "vitest";
import {
  addRecordedAssets,
  defaultRecordingSettings,
  recordingFocuses,
  recordingZoomFrames,
} from "../shared/recording";
import {
  createProject,
  defaultTransform,
  validateProject,
  type Asset,
  type Clip,
} from "../shared/model";
import { splitClip, transformAt } from "../shared/editor";
import { animationRanges, retimeAnimation } from "../shared/animation-ranges";
import { animateContent, animateCrop } from "../shared/crop-animation";

const asset: Asset = {
  id: "screen",
  path: "screen.mp4",
  name: "录屏",
  kind: "video",
  width: 1920,
  height: 1080,
  duration: 10,
  hasAudio: true,
};
const clip: Clip = {
  id: "screen-clip",
  assetId: asset.id,
  kind: "video",
  trackId: "video",
  name: "录屏",
  start: 3,
  sourceIn: 0,
  speed: 1,
  duration: 10,
  volume: 1,
  podcast: false,
  transform: { ...defaultTransform, scale: 0.84 },
  keyframes: [],
};
const sample = (
  time: number,
  x = 0.8,
  y = 0.1,
  click = false,
  visible = true,
) => ({ time, x, y, click, visible });

it("自动缩放处理点击边沿、压缩的静止采样和源时间，忽略不可见及越界坐标", () => {
  const recorded = {
    ...asset,
    cursor: {
      samples: [
        sample(0, 0.1, 0.1, true),
        sample(1, 0.2),
        sample(2, 0.8, 0.1, true),
        sample(2.1, 0.8, 0.1, true),
        sample(2.2),
        sample(3.5),
        sample(4, 4, 2, true),
        sample(5, 0.4, 0.4, true, false),
        sample(6, NaN),
      ],
    },
  };
  const trimmed = { ...clip, sourceIn: 1, speed: 2, duration: 2 };
  const focuses = recordingFocuses(recorded, trimmed);
  expect(focuses).toHaveLength(1); // One held click and its later rest share a focus.
  expect(focuses[0].time).toBe(0.5);
  const frames = recordingZoomFrames(recorded, trimmed, 2);
  expect(frames.length).toBe(4);
  expect(frames.every((f) => f.time >= 0 && f.time <= trimmed.duration)).toBe(
    true,
  );
  expect(frames[1].value).toMatchObject({
    scale: 0.84,
    contentScale: 2,
    contentX: -0.5,
    contentY: 0.5,
  });
  const animated = { ...trimmed, keyframes: frames };
  expect(animationRanges(animated)).toHaveLength(2); // Zoom in and out; no hold arrows.
  expect(transformAt(animated, 0).contentScale).toBe(1);
  expect(transformAt(animated, trimmed.duration).contentScale).toBe(1);
  const dwell = { ...asset, cursor: { samples: [sample(2), sample(4)] } };
  expect(recordingFocuses(dwell, clip)).toEqual([
    { time: 2.45, x: 0.8, y: 0.1 },
  ]);
  expect(recordingZoomFrames(asset, clip, 2)).toEqual([]);
  expect(recordingZoomFrames(dwell, { ...clip, duration: 0.5 }, 2)).toEqual([]);
});

it("录屏、镜头和背景分层导入，保留素材与原工程；禁用美化和缺少轨迹时不生成效果", () => {
  const project = createProject(),
    original = JSON.stringify(project);
  const screen = { ...asset, cursor: { samples: [sample(1, 0.8, 0.1, true)] } };
  const camera = { ...asset, id: "camera" },
    microphone = { ...asset, id: "mic", kind: "audio" as const };
  const background = {
    ...asset,
    id: "background",
    kind: "image" as const,
    hasAudio: false,
  };
  const results = [
    { asset: screen, kind: "screen" as const },
    { asset: camera, kind: "camera" as const },
    { asset: microphone, kind: "microphone" as const },
  ];
  const added = validateProject(
    addRecordedAssets(
      project,
      results,
      defaultRecordingSettings,
      5,
      background,
    ),
  );
  const recording = added.clips.find((c) => c.assetId === screen.id)!;
  expect(recording).toMatchObject({
    start: 5,
    duration: 10,
    transform: { scale: 0.84 },
    cursorStyle: { size: 40 },
    mediaFrame: { radius: 0 },
  });
  expect(recording.keyframes).toHaveLength(4);
  expect(added.clips.every((c) => c.start === 5)).toBe(true);
  expect(
    added.tracks.findIndex((t) => t.id === recording.trackId),
  ).toBeLessThan(added.tracks.findIndex((t) => t.name === "录屏背景"));
  expect(added.tracks[0].id).toBe(
    added.clips.find((c) => c.assetId === camera.id)!.trackId,
  );
  expect(JSON.stringify(project)).toBe(original);
  expect(screen.cursor.samples).toHaveLength(1);
  const plain = addRecordedAssets(
    project,
    [{ asset, kind: "screen" }],
    { ...defaultRecordingSettings, background: false, autoZoom: false },
    0,
  );
  expect(plain.clips[0]).toMatchObject({
    transform: defaultTransform,
    keyframes: [],
  });
  expect(plain.clips[0].cursorStyle).toBeUndefined();
  expect(plain.clips[0].mediaFrame).toBeUndefined();
  expect(plain.assets).toHaveLength(1);
  const fallback = addRecordedAssets(
    project,
    [{ asset, kind: "screen" }],
    defaultRecordingSettings,
    0,
  );
  expect(fallback.clips[0].transform.scale).toBe(1);
  expect(fallback.clips[0].keyframes).toEqual([]);
});

it("录后自动缩放可编辑端点、裁剪和时间，拆分与工程序列化保留动画和原始素材", () => {
  const screen = { ...asset, cursor: { samples: [sample(2, 0.8, 0.1, true)] } };
  const project = addRecordedAssets(
    createProject(),
    [{ asset: screen, kind: "screen" }],
    defaultRecordingSettings,
    3,
  );
  const recording = project.clips[0];
  const range = animationRanges(recording)[0];
  const edited = animateContent(
    recording,
    { scale: 2.5, x: -0.3, y: 0.2 },
    {
      time: range.end,
      auto: false,
      endpoint: { time: range.end, side: "end" },
    },
  );
  expect(animationRanges(edited)).toHaveLength(2);
  expect(transformAt(edited, range.start).contentScale).toBe(1);
  expect(transformAt(edited, range.end)).toMatchObject({
    scale: 1,
    contentScale: 2.5,
    contentX: -0.3,
    contentY: 0.2,
  });
  // Editing the zoom-in endpoint also updates its hold, but leaves zoom-out intact.
  expect(transformAt(edited, 3).contentScale).toBe(2.5);
  expect(transformAt(edited, 5).contentScale).toBe(1);
  const cropped = animateCrop(
    edited,
    { left: 0.1, top: 0, right: 0, bottom: 0 },
    { width: 1920, height: 1080 },
    project.canvas,
    {
      time: range.end,
      auto: false,
      endpoint: { time: range.end, side: "end" },
    },
  );
  expect(transformAt(cropped, range.end).cropLeft).toBe(0.1);
  expect(transformAt(cropped, range.start).cropLeft).toBe(0);
  const retimed = retimeAnimation(cropped, range, "end", 0.2, 30);
  expect(animationRanges(retimed)[0].end).toBeGreaterThan(range.end);
  const changed = { ...project, clips: [retimed] };
  const reopened = validateProject(JSON.parse(JSON.stringify(changed)));
  expect(reopened.clips[0].keyframes).toEqual(retimed.keyframes);
  expect(reopened.assets[0]).toEqual(screen);
  const split = splitClip(reopened, recording.id, recording.start + 2.5);
  const right = split.clips[1];
  for (const time of [0, 0.5, 2])
    expect(transformAt(right, time)).toEqual(transformAt(retimed, time + 2.5));
  expect(right.assetId).toBe(screen.id);
});
