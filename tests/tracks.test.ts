import { describe, expect, it } from "vitest";
import {
  createProject,
  newText,
  newTrack,
  numberTracks,
  validateProject,
  type Asset,
} from "../shared/model";
import { addMediaAssets } from "../shared/editor";

const image: Asset = {
  id: "image",
  name: "image.png",
  path: "image.png",
  kind: "image",
  width: 100,
  height: 80,
  duration: 0,
  hasAudio: false,
};

describe("通用编号轨道与图片粘贴", () => {
  it("默认轨道统一编号，旧类别与名称迁移时保留ID、状态、片段和动画", () => {
    const project = createProject();
    project.clips = [newText("audio", 2)];
    project.tracks[2].locked = true;
    project.tracks[2].muted = true;
    const legacy = {
      ...project,
      tracks: project.tracks.map((track, index) => ({
        ...track,
        name: ["文本与字幕", "画面", "声音"][index],
        kind: index === 2 ? "audio" : "visual",
      })),
    };
    const migrated = validateProject(legacy);
    expect(migrated.tracks.map((track) => track.name)).toEqual([
      "轨道3",
      "轨道2",
      "轨道1",
    ]);
    expect(migrated.tracks.some((track) => "kind" in track)).toBe(false);
    expect(migrated.tracks.map((track) => track.id)).toEqual(
      project.tracks.map((track) => track.id),
    );
    expect(migrated.tracks[2]).toMatchObject({ locked: true, muted: true });
    expect(migrated.clips).toEqual(project.clips);
  });
  it("不同媒体类型在不同时间使用同一条轨道", () => {
    const project = createProject();
    project.tracks = [project.tracks[2]];
    const audio: Asset = {
      ...image,
      id: "audio",
      name: "audio.wav",
      kind: "audio",
      duration: 1,
      hasAudio: true,
    };
    const withAudio = addMediaAssets(project, [audio], 0, true);
    const withImage = addMediaAssets(withAudio, [image], 2, true);
    expect(withImage.tracks).toHaveLength(1);
    expect(withImage.clips.map((clip) => clip.trackId)).toEqual([
      "audio",
      "audio",
    ]);
    expect(withImage.tracks[0].name).toBe("轨道1");
  });
  it("图片粘贴即使有空闲轨道也新增到顶部，保留原轨道的顺序与编号", () => {
    const project = createProject();
    const pasted = addMediaAssets(project, [image], 3, true, {
      newTrackForImages: true,
    });
    expect(pasted.tracks).toHaveLength(4);
    expect(pasted.tracks.slice(1)).toEqual(project.tracks);
    expect(pasted.tracks[0].name).toBe("轨道4");
    expect(pasted.clips[0]).toMatchObject({
      trackId: pasted.tracks[0].id,
      start: 3,
      duration: 5,
    });
    expect(project.tracks).toHaveLength(3);
    expect(project.clips).toHaveLength(0);
  });
  it("连续或批量粘贴每张图片都使用独立新轨道，素材引用不重复", () => {
    const other = { ...image, id: "other" };
    const batch = addMediaAssets(createProject(), [image, other], 1, true, {
      newTrackForImages: true,
    });
    const repeated = addMediaAssets(batch, [image], 1, true, {
      newTrackForImages: true,
    });
    expect(repeated.tracks).toHaveLength(6);
    expect(new Set(repeated.clips.map((clip) => clip.trackId)).size).toBe(3);
    expect(repeated.assets).toHaveLength(2);
    expect(repeated.clips.every((clip) => clip.start === 1)).toBe(true);
  });
  it("普通导入只添加素材，不创建轨道；视频粘贴仍可使用空闲轨道", () => {
    const project = createProject();
    expect(
      addMediaAssets(project, [image], 1, false, { newTrackForImages: true })
        .tracks,
    ).toEqual(project.tracks);
    const video: Asset = { ...image, id: "video", kind: "video", duration: 1 };
    const pasted = addMediaAssets(project, [video], 1, true, {
      newTrackForImages: true,
    });
    expect(pasted.tracks).toHaveLength(3);
    expect(pasted.clips[0].trackId).toBe(project.tracks[0].id);
  });
  it("普通添加避开锁定、隐藏及时间重叠的轨道，全部占用时新增通用轨道", () => {
    const project = createProject();
    project.tracks[0].locked = true;
    project.tracks[1].hidden = true;
    project.clips = [newText(project.tracks[2].id, 0)];
    const added = addMediaAssets(project, [image], 0, true);
    expect(added.tracks).toHaveLength(4);
    expect(added.clips[1].trackId).toBe(added.tracks[0].id);
  });
  it("顶部新增后旧轨道编号稳定，尾部插入后可统一重编号", () => {
    const tracks = createProject().tracks;
    const upper = numberTracks([newTrack(tracks.length), ...tracks]);
    expect(upper.map((track) => track.name)).toEqual([
      "轨道4",
      "轨道3",
      "轨道2",
      "轨道1",
    ]);
    expect(numberTracks(upper)).toBe(upper);
    const lower = numberTracks([...tracks, newTrack(tracks.length)]);
    expect(lower.map((track) => track.name)).toEqual([
      "轨道4",
      "轨道3",
      "轨道2",
      "轨道1",
    ]);
  });
});
