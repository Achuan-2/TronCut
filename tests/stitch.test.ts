import { describe, expect, it } from "vitest";
import {
  createProject,
  newText,
  validateProject,
  type Clip,
} from "../shared/model";
import { splitClip, transformAt } from "../shared/editor";
import { setClipSpeed } from "../shared/clip-speed";
import {
  mediaSegments,
  sourceTimeAt,
  stitchBoundaries,
} from "../shared/media-segments";
import {
  stitchClips,
  stitchSelectionError,
  unstitchClips,
} from "../shared/stitch";
import { frameSnapshot } from "../shared/frame-snapshot";
import { fadeOpacity } from "../shared/effects";
import {
  createBehavior,
  fitBehaviorDuration,
  glyphMotion,
} from "../shared/behaviors";

function fixture() {
  const project = createProject();
  project.assets = [
    {
      id: "asset",
      name: "source.mp4",
      path: "source.mp4",
      kind: "video",
      duration: 20,
      width: 160,
      height: 90,
      hasAudio: true,
    },
  ];
  project.clips = [0, 4, 8].map((sourceIn, index) => ({
    ...newText("video", 2 + index * 2),
    id: `clip-${index}`,
    kind: "video" as const,
    assetId: "asset",
    duration: 2,
    sourceIn,
  }));
  return project;
}

describe("可编辑片段拼接", () => {
  it("移除拼接和再次分割保持整体行为的相位，不会在缝处重新播放入场", () => {
    const project = fixture();
    const stitched = stitchClips(
      project,
      project.clips.map((clip) => clip.id),
    );
    const clip = stitched.clips[0];
    clip.behaviors = [createBehavior("fade", clip.duration)!];
    clip.fadeIn = 3;
    clip.fadeOut = 2;
    let result = unstitchClips(stitched, [clip.id]);
    result = splitClip(result, result.clips[1].id, result.clips[1].start + 0.5);
    for (const piece of result.clips) {
      expect(fitBehaviorDuration(piece)).toBe(piece);
      for (const local of [0, 0.1, piece.duration / 2]) {
        expect(fadeOpacity(piece, local)).toBeCloseTo(
          fadeOpacity(clip, piece.start - clip.start + local),
          10,
        );
        expect(glyphMotion(piece, local, 0, 1)).toEqual(
          glyphMotion(clip, piece.start - clip.start + local, 0, 1),
        );
      }
    }
  });
  it("把相邻片段变成一个对象，保留删掉源时间的跳跃和每一处缝", () => {
    const project = fixture();
    const original = structuredClone(project);
    const result = stitchClips(
      project,
      project.clips.map((clip) => clip.id),
    );
    expect(result.clips).toHaveLength(1);
    const clip = result.clips[0];
    expect(clip).toMatchObject({ start: 2, duration: 6, sourceIn: 0 });
    expect(stitchBoundaries(clip)).toEqual([2, 4]);
    expect(
      [0, 1.9, 2, 3.9, 4, 6].map((time) => sourceTimeAt(clip, time)),
    ).toEqual([0, 1.9, 4, 5.9, 8, 10]);
    expect(
      validateProject(JSON.parse(JSON.stringify(result))).clips[0].stitch,
    ).toEqual(clip.stitch);
    expect(project).toEqual(original);
  });

  it("移除一处缝后还能移除剩余拼接，并保留整体关键帧曲线", () => {
    const project = fixture();
    const stitched = stitchClips(
      project,
      project.clips.map((clip) => clip.id),
    );
    const clip = stitched.clips[0];
    clip.keyframes = [
      { time: 0, value: clip.transform },
      {
        time: 6,
        value: { ...clip.transform, scale: 2, x: 0.7 },
        easing: "exponential",
      },
    ];
    const one = unstitchClips(stitched, [clip.id], 2);
    expect(one.clips).toHaveLength(2);
    expect(one.clips[0].stitch).toBeUndefined();
    expect(stitchBoundaries(one.clips[1])).toEqual([2]);
    const all = unstitchClips(
      one,
      one.clips.map((clip) => clip.id),
    );
    expect(
      all.clips.map((clip) => [
        clip.start,
        clip.duration,
        clip.sourceIn,
        clip.stitch,
      ]),
    ).toEqual([
      [2, 2, 0, undefined],
      [4, 2, 4, undefined],
      [6, 2, 8, undefined],
    ]);
    for (const piece of all.clips)
      for (const local of [0, 0.1, 1, 1.9])
        expect(transformAt(piece, local)).toEqual(
          transformAt(clip, piece.start - clip.start + local),
        );
  });

  it("变速、裁剪和 Ctrl+K 分割按虚拟源时间工作，截帧使用实际源时间", () => {
    const project = fixture();
    const stitched = stitchClips(
      project,
      project.clips.map((clip) => clip.id),
    );
    const clip = setClipSpeed(stitched.clips[0], 2);
    expect(stitchBoundaries(clip)).toEqual([1, 2]);
    const trimmed: Clip = { ...clip, sourceIn: 1, duration: 2 };
    expect(mediaSegments(trimmed)).toEqual([
      { start: 0, sourceIn: 1, duration: 1 },
      { start: 0.5, sourceIn: 4, duration: 2 },
      { start: 1.5, sourceIn: 8, duration: 1 },
    ]);
    const result = splitClip(
      { ...stitched, clips: [trimmed] },
      clip.id,
      clip.start + 0.5,
    );
    expect(result.clips[0]).toMatchObject({ sourceIn: 1, duration: 0.5 });
    expect(result.clips[0].stitch).toBeUndefined();
    expect(sourceTimeAt(result.clips[1], 0)).toBe(4);
    expect(sourceTimeAt(result.clips[1], 1)).toBe(8);
    const snapshot = frameSnapshot(
      { ...stitched, clips: [trimmed] },
      trimmed.start + 1.5,
    );
    expect(snapshot.clips[0].sourceIn).toBe(8);
    expect(snapshot.clips[0].stitch).toBeUndefined();
  });

  it("继续拼接时展开已有源区间，不嵌套、不恢复被剪掉的内容", () => {
    const project = fixture();
    const first = stitchClips(project, ["clip-0", "clip-1"]);
    const next = stitchClips(
      first,
      first.clips.map((clip) => clip.id),
    );
    expect(next.clips).toHaveLength(1);
    expect(next.clips[0].stitch).toEqual([
      { sourceIn: 0, duration: 2 },
      { sourceIn: 4, duration: 2 },
      { sourceIn: 8, duration: 2 },
    ]);
  });

  it("拒绝锁定、跨轨、空隙、重叠和不兼容属性，避免丢失原有编辑", () => {
    for (const change of [
      (clip: Clip) => {
        clip.trackId = "audio";
      },
      (clip: Clip) => {
        clip.start += 1;
      },
      (clip: Clip) => {
        clip.start -= 1;
      },
      (clip: Clip) => {
        clip.transform.scale = 2;
      },
      (clip: Clip) => {
        clip.volume = 0.5;
      },
    ]) {
      const project = fixture();
      change(project.clips[1]);
      const ids = project.clips.map((clip) => clip.id);
      expect(stitchSelectionError(project, ids)).not.toBeNull();
      expect(stitchClips(project, ids)).toBe(project);
    }
    const project = fixture();
    project.tracks.find((track) => track.id === "video")!.locked = true;
    expect(
      stitchClips(
        project,
        project.clips.map((clip) => clip.id),
      ),
    ).toBe(project);
  });

  it("项目验证拒绝越界拼接和非媒体拼接", () => {
    const project = fixture();
    const result = stitchClips(
      project,
      project.clips.map((clip) => clip.id),
    );
    result.clips[0].stitch![0].sourceIn = 20;
    expect(() => validateProject(result)).toThrow("拼接源区间无效");
  });
});
