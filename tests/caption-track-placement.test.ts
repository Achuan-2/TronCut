import { describe, expect, it } from "vitest";
import { appendCaptionCues } from "../shared/captions";
import { addMediaAssets } from "../shared/editor";
import {
  createProject,
  newText,
  validateProject,
  type Asset,
  type Project,
} from "../shared/model";
import {
  addRecordedAssets,
  defaultRecordingSettings,
} from "../shared/recording";

const source: Asset = {
  id: "source",
  name: "素材",
  path: "source.mp4",
  kind: "video",
  duration: 5,
  width: 160,
  height: 90,
  hasAudio: true,
};

function captionProject() {
  let project = createProject();
  for (const text of ["中文字幕", "英文字幕"]) {
    project = appendCaptionCues(project, [{ start: 0, end: 5, text }], {
      newTrack: true,
    }).project;
  }
  project.clips.push(
    ...project.tracks
      .filter((track) => !track.captionTrack)
      .map((track) => newText(track.id, 0)),
  );
  return project;
}

function expectNewTracksBelowCaptions(before: Project, after: Project) {
  const oldIds = new Set(before.tracks.map((track) => track.id));
  const lastCaption = Math.max(
    ...after.tracks.map((track, index) => (track.captionTrack ? index : -1)),
  );
  expect(
    after.tracks
      .filter((track) => oldIds.has(track.id))
      .map((track) => track.id),
  ).toEqual(before.tracks.map((track) => track.id));
  for (const [index, track] of after.tracks.entries()) {
    if (!oldIds.has(track.id)) expect(index).toBeGreaterThan(lastCaption);
  }
  expect(after.clips.slice(0, before.clips.length)).toEqual(before.clips);
  expect(
    validateProject(JSON.parse(JSON.stringify(after))).tracks.map(
      (track) => track.id,
    ),
  ).toEqual(after.tracks.map((track) => track.id));
}

describe("字幕轨道下方默认新增媒体轨道", () => {
  it.each(["image", "video", "audio"] as const)(
    "拖放 %s 到已占用轨道时，在字幕下方新增轨道",
    (kind) => {
      const project = captionProject();
      const original = structuredClone(project);
      const added = addMediaAssets(project, [{ ...source, kind }], 0, true, {
        trackId: "video",
      });
      expect(added.tracks).toHaveLength(project.tracks.length + 1);
      expect(added.tracks[2].id).toBe(added.clips.at(-1)!.trackId);
      expectNewTracksBelowCaptions(project, added);
      expect(project).toEqual(original);
    },
  );

  it("批量拖放连续新增的媒体轨道都位于字幕下方，隐藏或锁定字幕也保留位置", () => {
    const project = captionProject();
    project.tracks[0].hidden = true;
    project.tracks[1].locked = true;
    const added = addMediaAssets(
      project,
      [source, { ...source, id: "second" }],
      0,
      true,
    );
    expect(added.tracks).toHaveLength(project.tracks.length + 2);
    expectNewTracksBelowCaptions(project, added);
  });

  it("字幕轨道不在顶部时也插到最后一条字幕下方，保留用户排序", () => {
    const project = captionProject();
    const top = project.tracks.splice(2, 1)[0];
    project.tracks.splice(0, 0, top);
    const added = addMediaAssets(project, [source], 0, true);
    expect(added.tracks[3].id).toBe(added.clips.at(-1)!.trackId);
    expectNewTracksBelowCaptions(project, added);
  });

  it("明确拖到有空位的现有轨道时复用该轨道", () => {
    const project = captionProject();
    const added = addMediaAssets(project, [source], 8, true, {
      trackId: "audio",
    });
    expect(added.tracks.map((track) => track.id)).toEqual(
      project.tracks.map((track) => track.id),
    );
    expect(added.clips.at(-1)).toMatchObject({ trackId: "audio", start: 8 });
  });

  it("粘贴复用字幕下方空白媒体轨道，不把素材放进空白字幕轨道", () => {
    const project = captionProject();
    project.clips = [];
    const added = addMediaAssets(project, [source], 0, true, {
      pasteToTop: true,
    });
    expect(added.tracks).toHaveLength(project.tracks.length);
    expect(added.clips[0].trackId).toBe(project.tracks[2].id);
    expect(
      added.tracks.find((track) => track.id === added.clips[0].trackId)!
        .captionTrack,
    ).not.toBe(true);
  });

  it("录屏画面、摄像头、麦克风和背景作为完整层块插到字幕下方", () => {
    const project = captionProject();
    const added = addRecordedAssets(
      project,
      [
        { asset: { ...source, id: "mic", kind: "audio" }, kind: "microphone" },
        { asset: source, kind: "screen" },
        { asset: { ...source, id: "camera" }, kind: "camera" },
      ],
      { ...defaultRecordingSettings, autoZoom: false },
      2,
      { ...source, id: "background", kind: "image" },
    );
    expect(added.tracks).toHaveLength(project.tracks.length + 4);
    const addedClips = added.clips.slice(project.clips.length);
    expect(
      added.tracks
        .slice(2, 6)
        .map(
          (track) =>
            addedClips.find((clip) => clip.trackId === track.id)!.recordingRole,
        ),
    ).toEqual(["camera", "screen", "microphone", "background"]);
    expect(addedClips.every((clip) => clip.start === 2)).toBe(true);
    expectNewTracksBelowCaptions(project, added);
  });

  it("没有字幕轨道时，录制与拖放仍默认新增到顶部", () => {
    const project = createProject();
    project.clips = project.tracks.map((track) => newText(track.id, 0));
    const added = addMediaAssets(project, [source], 0, true);
    expect(added.tracks[0].id).toBe(added.clips.at(-1)!.trackId);
    const recorded = addRecordedAssets(
      project,
      [{ asset: source, kind: "screen" }],
      { ...defaultRecordingSettings, background: false, autoZoom: false },
      0,
    );
    expect(recorded.tracks[0].id).toBe(recorded.clips.at(-1)!.trackId);
  });
});
