import { expect, it } from "vitest";
import {
  addRecordedAssets,
  defaultRecordingSettings,
} from "../shared/recording";
import {
  createProject,
  defaultTransform,
  validateProject,
  type Asset,
} from "../shared/model";
import {
  recordingGroups,
  recordingTimeline,
  recordingMaster,
  updateRecordingObject,
  trimRecordingObject,
} from "../shared/recording-objects";
import {
  deleteClips,
  groupSelection,
  moveClips,
  pasteClips,
  selectionWithGroups,
  splitSelection,
} from "../shared/timeline";
import { transformAt } from "../shared/editor";
import { saveProject, openProject } from "../electron/project-store";
import { RecordingStyleStore } from "../electron/recording-style";
import { probeMedia } from "../electron/media";
import { runProcess, findBinary } from "../electron/process";
import fs from "node:fs/promises";
import path from "node:path";
import { toggleTrack, removeTrack } from "../shared/tracks";

const screen: Asset = {
  id: "screen",
  path: "screen.mp4",
  name: "录屏",
  kind: "video",
  width: 160,
  height: 90,
  duration: 8,
  hasAudio: true,
  cursor: {
    samples: [
      { time: 1, x: 0.2, y: 0.5, click: true, visible: true },
      { time: 2, x: 0.2, y: 0.5, click: false, visible: true },
      { time: 3, x: 0.8, y: 0.5, click: true, visible: true },
    ],
  },
};
const background: Asset = {
  ...screen,
  id: "bg",
  path: "background.png",
  name: "背景",
  kind: "image",
  cursor: undefined,
  hasAudio: false,
};
function recording(backgroundEnabled = true) {
  const project = createProject();
  project.canvas = { width: 160, height: 90, fps: 10, background: "#000000" };
  return addRecordedAssets(
    project,
    [
      { asset: screen, kind: "screen" },
      {
        asset: { ...screen, id: "mic", kind: "audio", cursor: undefined },
        kind: "microphone",
      },
      { asset: { ...screen, id: "camera", cursor: undefined }, kind: "camera" },
    ],
    { ...defaultRecordingSettings, background: backgroundEnabled },
    2,
    background,
  );
}

it("录屏及镜头、声音、背景自动组成一个对象，取消组合释放所有原素材", () => {
  const project = recording();
  const master = project.clips[0],
    selected = selectionWithGroups(project, [master.id]);
  expect(selected).toHaveLength(4);
  expect(recordingGroups(project).size).toBe(1);
  expect(recordingTimeline(project).clips).toEqual([master]);
  expect(
    recordingTimeline(project).tracks.some(
      (track) => track.id === project.clips[3].trackId,
    ),
  ).toBe(false);
  expect(recordingMaster(project, project.clips[3].id)?.id).toBe(master.id);
  const released = groupSelection(project, [master.id], true);
  expect(recordingTimeline(released).clips).toHaveLength(4);
  expect(
    released.clips.every(
      (clip) => !clip.groupId && !clip.recording && !clip.recordingRole,
    ),
  ).toBe(true);
  expect(released.clips.map((clip) => clip.keyframes)).toEqual(
    project.clips.map((clip) => clip.keyframes),
  );
  const screenTrack = master.trackId;
  const micTrack = project.clips.find(
    (clip) => clip.recordingRole === "microphone",
  )!.trackId;
  const legacy = {
    ...project,
    tracks: [
      project.tracks.find((track) => track.id === micTrack)!,
      ...project.tracks.filter((track) => track.id !== micTrack),
    ],
  };
  const ordered = groupSelection(legacy, [master.id], true);
  expect(
    ordered.tracks.findIndex((track) => track.id === screenTrack) + 1,
  ).toBe(ordered.tracks.findIndex((track) => track.id === micTrack));
  const sharedTrack = {
    ...legacy,
    clips: [
      ...legacy.clips,
      {
        ...legacy.clips.find((clip) => clip.trackId === micTrack)!,
        id: "unrelated-audio",
        groupId: undefined,
        recordingRole: undefined,
        start: 20,
      },
    ],
  };
  expect(groupSelection(sharedTrack, [master.id], true).tracks).toEqual(
    legacy.tracks,
  );
});

it("对象移动、复制、删除与拆分保持子素材同步，副本和拆分分别成为独立对象", () => {
  const project = recording(),
    master = project.clips[0];
  const moved = moveClips(project, [master.id], 3);
  expect(moved.clips.every((clip) => clip.start === 5)).toBe(true);
  const pasted = pasteClips(project, project.clips, 12).project;
  expect(recordingGroups(pasted).size).toBe(2);
  expect(recordingTimeline(pasted).clips).toHaveLength(2);
  const split = splitSelection(project, [master.id], 5);
  expect(recordingGroups(split).size).toBe(2);
  expect(recordingTimeline(split).clips.map((clip) => clip.duration)).toEqual([
    3, 5,
  ]);
  expect(deleteClips(project, [master.id]).clips).toEqual([]);
  const locked = {
    ...project,
    tracks: project.tracks.map((track) =>
      track.id === project.clips[1].trackId
        ? { ...track, locked: true }
        : track,
    ),
  };
  expect(moveClips(locked, [master.id], 3)).toBe(locked);
});

it("更换静态及动态背景、圆角、鼠标不覆盖已编辑镜头，禁用后可重新添加背景", () => {
  const project = recording(),
    master = project.clips[0],
    frames = master.keyframes;
  const video = {
    ...background,
    id: "animated",
    kind: "video" as const,
    width: 320,
    duration: 1,
  };
  const changed = validateProject(
    updateRecordingObject(
      project,
      master.id,
      {
        preset: "mint",
        cursor: {
          ...defaultRecordingSettings.cursor,
          style: "windows11",
          size: 56,
        },
        radius: 24,
      },
      video,
    ),
  );
  const updated = changed.clips.find((clip) => clip.id === master.id)!;
  expect(updated.keyframes).toEqual(frames);
  expect(updated).toMatchObject({
    mediaFrame: { radius: 24 },
    cursorStyle: { style: "windows11", size: 56 },
  });
  expect(
    changed.clips.find((clip) => clip.recordingRole === "background"),
  ).toMatchObject({ kind: "video", loop: true, duration: 8, volume: 0 });
  const disabled = updateRecordingObject(changed, master.id, {
    background: false,
  });
  expect(
    disabled.clips.some((clip) => clip.recordingRole === "background"),
  ).toBe(false);
  expect(disabled.clips[0].transform.scale).toBeCloseTo(1);
  const enabled = updateRecordingObject(
    disabled,
    master.id,
    { background: true, preset: "mint" },
    background,
  );
  expect(recordingTimeline(enabled).clips).toHaveLength(1);
  expect(enabled.clips[0].transform.scale).toBeCloseTo(0.84);
  expect(enabled.clips[0].mediaFrame?.radius).toBe(24);
});

it("仅录屏与整体缩放可来回切换，裁剪后样式编辑保留源时间与镜头进度", () => {
  const project = recording(),
    master = project.clips[0];
  const scene = updateRecordingObject(project, master.id, {
    zoomBackground: true,
  });
  const restored = updateRecordingObject(scene, master.id, {
    zoomBackground: false,
  });
  for (const time of [0, 1.5, 2.5, 4])
    expect(transformAt(restored.clips[0], time).contentScale).toBeCloseTo(
      transformAt(master, time).contentScale ?? 1,
      6,
    );
  const trimmed = trimRecordingObject(project, master, {
    ...master,
    start: 3,
    duration: 6,
    sourceIn: 1,
    animationOffset: 1,
  });
  expect(
    trimmed.clips.every(
      (clip) => clip.start === 3 && clip.duration === 6 && clip.sourceIn === 1,
    ),
  ).toBe(true);
  const styled = updateRecordingObject(
    trimmed,
    master.id,
    { preset: "violet" },
    background,
  );
  expect(styled.clips[0]).toMatchObject({
    sourceIn: 1,
    animationOffset: 1,
    duration: 6,
  });
  expect(styled.clips[0].keyframes).toEqual(master.keyframes);
});

it("归档重开保留录屏对象、动态背景和统一样式", async () => {
  const root = path.resolve(`test-output/recording-object-${Date.now()}`);
  await fs.mkdir(root, { recursive: true });
  const file = path.join(root, "screen.mp4");
  await runProcess(findBinary("ffmpeg"), [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=white:s=160x90:r=10:d=2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    file,
  ]);
  const source = { ...(await probeMedia(file)), cursor: screen.cursor };
  const bg = await new RecordingStyleStore(root).background(160, 90, "violet");
  const project = addRecordedAssets(
    createProject(),
    [{ asset: source, kind: "screen" }],
    defaultRecordingSettings,
    0,
    bg,
  );
  const archive = path.join(root, "recording.troncut");
  await saveProject(project, archive);
  const reopened = await openProject(archive);
  expect(recordingTimeline(reopened).clips).toHaveLength(1);
  expect(reopened.clips[0].recording).toEqual(project.clips[0].recording);
  expect(
    recordingTimeline(groupSelection(reopened, [reopened.clips[0].id], true))
      .clips,
  ).toHaveLength(2);
});

it("轨道静音、隐藏、独奏和锁定作用于整个录屏对象，删除时清理内部素材", () => {
  const project = recording(),
    trackId = project.clips[0].trackId;
  const memberTracks = new Set(project.clips.map((clip) => clip.trackId));
  for (const key of ["muted", "hidden", "solo", "locked"] as const) {
    const changed = toggleTrack(project, trackId, key);
    expect(
      changed.tracks
        .filter((track) => memberTracks.has(track.id))
        .every((track) => track[key]),
    ).toBe(true);
    expect(
      toggleTrack(changed, trackId, key)
        .tracks.filter((track) => memberTracks.has(track.id))
        .every((track) => !track[key]),
    ).toBe(true);
  }
  expect(removeTrack(project, trackId).clips).toEqual([]);
});
