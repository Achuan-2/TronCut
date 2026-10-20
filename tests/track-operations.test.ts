import { describe, expect, it } from "vitest";
import {
  createProject,
  newText,
  numberTracks,
  validateProject,
} from "../shared/model";
import {
  displayTrackName,
  insertTrack,
  moveTrack,
  removeTrack,
  removeEmptyTracks,
  renameTrack,
  toggleTrack,
  isTrackActive,
} from "../shared/tracks";
import { frameSnapshot } from "../shared/frame-snapshot";

describe("轨道右键操作", () => {
  it("上下插入和四向移动保留片段所属轨道、时间与自定义名称", () => {
    let project = createProject();
    project.clips = [newText("video", 2)];
    project = renameTrack(project, "video", "我的画面");
    const before = project.clips;
    project = insertTrack(project, "video", "above");
    expect(project.tracks.findIndex((track) => track.id === "video")).toBe(2);
    project = insertTrack(project, "video", "below");
    expect(project.tracks[3].id).not.toBe("video");
    for (const [direction, expected] of [
      ["top", 0],
      ["down", 1],
      ["bottom", 4],
      ["up", 3],
    ] as const) {
      project = moveTrack(project, "video", direction);
      expect(project.tracks[expected].id).toBe("video");
      expect(project.clips).toBe(before);
      expect(project.tracks[expected].name).toBe("我的画面");
    }
    expect(validateProject(project).tracks[3]).toMatchObject({
      name: "我的画面",
      customName: true,
    });
    expect(numberTracks(project.tracks)).toBe(project.tracks);
  });
  it("字幕重命名覆盖默认显示名称并可随项目保存", () => {
    const project = createProject();
    project.tracks[0].captionTrack = true;
    expect(displayTrackName(project.tracks, "titles")).toBe("字幕");
    const renamed = renameTrack(project, "titles", "  中文字幕  ");
    expect(displayTrackName(validateProject(renamed).tracks, "titles")).toBe(
      "中文字幕",
    );
    expect(renameTrack(project, "titles", " ")).toBe(project);
  });
  it("移除轨道只移除其媒体，锁定轨道和最后一条轨道保留", () => {
    const project = createProject();
    project.clips = [newText("titles", 0), newText("video", 2)];
    const next = removeTrack(project, "titles");
    expect(next.clips).toEqual([project.clips[1]]);
    expect(next.tracks).toHaveLength(2);
    expect(
      removeTrack(toggleTrack(project, "titles", "locked"), "titles").clips,
    ).toBe(project.clips);
    const single = { ...next, tracks: [next.tracks[0]], clips: [] };
    expect(removeTrack(single, single.tracks[0].id)).toBe(single);
    validateProject(next);
  });
  it("批量清理空轨道保留有内容的轨道、锁定轨道以及至少一条轨道", () => {
    const project = createProject();
    project.clips = [newText("video", 0)];
    project.tracks[0].locked = true;
    const next = removeEmptyTracks(project);
    expect(next.tracks.map((track) => track.id)).toEqual(["titles", "video"]);
    expect(next.clips).toBe(project.clips);
    expect(removeEmptyTracks(next)).toBe(next);
    expect(removeEmptyTracks(createProject()).tracks).toHaveLength(1);
  });
  it("独奏可多轨启用，退出后恢复原隐藏和静音状态，截帧遵循同一可见性", () => {
    const project = createProject();
    project.clips = [
      newText("titles", 0),
      newText("video", 0),
      newText("audio", 0),
    ];
    project.tracks[2].hidden = true;
    project.tracks[1].muted = true;
    const solo = toggleTrack(project, "video", "solo");
    expect(
      solo.tracks
        .filter((track) => isTrackActive(solo.tracks, track.id))
        .map((track) => track.id),
    ).toEqual(["video"]);
    expect(frameSnapshot(solo, 1).clips.map((clip) => clip.trackId)).toEqual([
      "video",
    ]);
    const both = toggleTrack(solo, "titles", "solo");
    expect(
      both.tracks.filter((track) => isTrackActive(both.tracks, track.id)),
    ).toHaveLength(2);
    const restored = toggleTrack(solo, "video", "solo");
    expect(restored.tracks[1].muted).toBe(true);
    expect(restored.tracks[2].hidden).toBe(true);
    expect(
      restored.tracks.filter((track) =>
        isTrackActive(restored.tracks, track.id),
      ),
    ).toHaveLength(2);
    expect(validateProject(solo).tracks[1].solo).toBe(true);
  });
});
