import { describe, expect, it } from "vitest";
import {
  createProject,
  defaultTransform,
  newText,
  validateProject,
  type Clip,
} from "../shared/model";
import { transformAt } from "../shared/editor";
import { animationRanges } from "../shared/animation-ranges";
import { removeAnimation } from "../shared/animation-edit";
import {
  clearVideoZoomPan,
  setVideoZoomPan,
  unzoomVideoPreview,
  zoomPanAt,
} from "../shared/video-zoom-pan";

function fixture() {
  const p = createProject();
  p.assets = [
    {
      id: "asset",
      name: "video.mp4",
      path: "video.mp4",
      kind: "video",
      duration: 20,
      width: 160,
      height: 90,
      hasAudio: false,
    },
  ];
  const video = (
    id: string,
    start: number,
    x: number,
    scale: number,
  ): Clip => ({
    ...newText("video", start),
    id,
    assetId: "asset",
    kind: "video",
    duration: 8,
    transform: { ...defaultTransform, x, scale },
  });
  p.clips = [video("left", 0, 0.25, 0.4), video("right", 1, 0.75, 0.2)];
  return p;
}

describe("缩放与平移创建视频片段动画", () => {
  it("所有当前视频同步添加一秒动画，保留相对布局且不创建画布关键帧", () => {
    const p = fixture();
    const result = setVideoZoomPan(p, { scale: 2, x: 0.6 }, 4);
    expect(result.camera).toBeUndefined();
    expect(
      animationRanges(result.clips[0]).map(({ start, end }) => [start, end]),
    ).toEqual([[3, 4]]);
    expect(
      animationRanges(result.clips[1]).map(({ start, end }) => [start, end]),
    ).toEqual([[2, 3]]);
    expect(transformAt(result.clips[0], 4).x).toBeCloseTo(-0.2);
    expect(transformAt(result.clips[0], 4).scale).toBe(0.8);
    expect(transformAt(result.clips[1], 3).x).toBeCloseTo(0.8);
    expect(transformAt(result.clips[1], 3).scale).toBe(0.4);
    expect(transformAt(result.clips[0], 2)).toEqual(p.clips[0].transform);
  });
  it("同一时间调整不累计放大，后续动画保留静止间隔，保存校验保留取景状态", () => {
    const p = fixture();
    const first = setVideoZoomPan(p, { scale: 2 }, 4);
    const changed = setVideoZoomPan(first, { scale: 3 }, 4);
    expect(transformAt(changed.clips[0], 4).scale).toBeCloseTo(1.2);
    expect(zoomPanAt(changed, 4).scale).toBe(3);
    const restored = validateProject(JSON.parse(JSON.stringify(changed)));
    expect(zoomPanAt(restored, 4).scale).toBe(3);
    const next = setVideoZoomPan(restored, { scale: 1, x: 0.5, y: 0.5 }, 7);
    expect(
      animationRanges(next.clips[0]).map(({ start, end }) => [start, end]),
    ).toEqual([
      [3, 4],
      [6, 7],
    ]);
    expect(transformAt(next.clips[0], 7).scale).toBeCloseTo(0.4);
  });
  it("清除视频运镜及概览还原保留原始位置和尺寸", () => {
    const p = fixture();
    const zoomed = setVideoZoomPan(p, { scale: 2, x: 0.6 }, 4);
    const overview = unzoomVideoPreview(zoomed, 4);
    expect(overview.clips[0].transform.scale).toBeCloseTo(0.4);
    expect(overview.clips[0].transform.x).toBeCloseTo(0.25);
    const removed = removeAnimation(
      zoomed.clips[0],
      animationRanges(zoomed.clips[0])[0],
    );
    expect(zoomPanAt({ ...zoomed, clips: [removed] }, 4).scale).toBe(1);
    const cleared = clearVideoZoomPan(zoomed);
    expect(animationRanges(cleared.clips[0])).toHaveLength(0);
    expect(transformAt(cleared.clips[0], 4).x).toBeCloseTo(0.25);
    expect(transformAt(cleared.clips[0], 4).scale).toBeCloseTo(0.4);
    expect(cleared.clips[0].keyframes.every((frame) => !frame.zoomPan)).toBe(
      true,
    );
    p.clips[0].transform.x = 0.12345678912345;
    p.clips[0].transform.scale = 0.3333333333333;
    const fractional = clearVideoZoomPan(
      setVideoZoomPan(p, { scale: 1.85, x: 0.501 }, 4),
    );
    expect(animationRanges(fractional.clips[0])).toHaveLength(0);
  });
  it("锁定、隐藏、当前时间外的视频与非视频片段不被修改", () => {
    const p = fixture();
    p.tracks[0].locked = true;
    p.clips[0].trackId = p.tracks[0].id;
    const text = newText("titles", 0);
    p.clips.push(text, { ...p.clips[1], id: "future", start: 10 });
    const result = setVideoZoomPan(p, { scale: 2 }, 4);
    expect(result.clips[0]).toBe(p.clips[0]);
    expect(result.clips[2]).toBe(text);
    expect(result.clips[3]).toBe(p.clips[3]);
    const empty = setVideoZoomPan(p, { scale: 2 }, 20);
    expect(empty).toBe(p);
    p.tracks.find((track) => track.id === "video")!.hidden = true;
    expect(setVideoZoomPan(p, { scale: 2 }, 4)).toBe(p);
  });
});
