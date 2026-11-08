import { expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  createProject,
  newText,
  validateProject,
  type Asset,
} from "../shared/model";
import {
  addRecordedAssets,
  defaultRecordingSettings,
} from "../shared/recording";
import {
  syncRecordingTiming,
  updateRecordingObject,
} from "../shared/recording-objects";
import {
  removeClipSpeed,
  setClipSpeed,
  setSpeedDuration,
} from "../shared/clip-speed";
import { frameSnapshot } from "../shared/frame-snapshot";
import { projectIndex } from "../shared/project-index";
import { exportFrame, exportVideo } from "../electron/export";
import { findBinary, runProcess } from "../electron/process";

function fixture() {
  const asset: Asset = {
    id: "screen",
    name: "录屏",
    path: "screen.mp4",
    kind: "video",
    width: 160,
    height: 90,
    duration: 4,
    hasAudio: false,
  };
  const project = addRecordedAssets(
    createProject(),
    [
      { asset, kind: "screen" },
      {
        asset: { ...asset, id: "mic", kind: "audio", hasAudio: true },
        kind: "microphone",
      },
      { asset: { ...asset, id: "camera" }, kind: "camera" },
    ],
    { ...defaultRecordingSettings, autoZoom: false },
    1,
    { ...asset, id: "bg", kind: "image" },
  );
  project.canvas = { width: 160, height: 90, fps: 10, background: "#000000" };
  return project;
}

it("录屏变速后背景和声音仅在录屏窗口内生效，摄像头独立，重复同步不产生修改", () => {
  const project = fixture();
  const camera = project.clips.find((clip) => clip.recordingRole === "camera")!;
  const master = project.clips[0];
  expect(syncRecordingTiming(project)).toBe(project);
  const updated = {
    ...project,
    clips: project.clips.map((clip) =>
      clip.id === master.id ? setClipSpeed(clip, 2) : clip,
    ),
  };
  const synced = syncRecordingTiming(updated);
  for (const clip of synced.clips.filter(
    (clip) => clip.groupId === master.groupId,
  )) {
    expect(clip).toMatchObject({ start: 1, duration: 2, speed: 2 });
  }
  expect(synced.clips.find((clip) => clip.id === camera.id)).toBe(camera);
  for (const time of [0.9, 3, 4]) {
    expect(
      projectIndex(synced)
        .active(synced, time)
        .some((clip) => clip.recordingRole === "background"),
    ).toBe(false);
    expect(
      frameSnapshot(synced, time).clips.some(
        (clip) => clip.recordingRole === "background",
      ),
    ).toBe(false);
  }
  expect(
    frameSnapshot(synced, 2).clips.some(
      (clip) => clip.recordingRole === "background",
    ),
  ).toBe(true);
  expect(syncRecordingTiming(synced)).toBe(synced);
  expect(
    validateProject(JSON.parse(JSON.stringify(synced))).clips[0].duration,
  ).toBe(2);
});

it("持续时间调整、移除变速和旧项目时长不一致均以录屏为准", () => {
  let project = fixture();
  for (const update of [
    (clip: (typeof project.clips)[0]) => setSpeedDuration(clip, 1, 10),
    removeClipSpeed,
    (clip: (typeof project.clips)[0]) => ({ ...clip, start: 2, duration: 1.5 }),
  ]) {
    project = syncRecordingTiming({
      ...project,
      clips: [update(project.clips[0]), ...project.clips.slice(1)],
    });
    const master = project.clips[0];
    expect(
      project.clips
        .filter((clip) => clip.groupId === master.groupId)
        .every(
          (clip) =>
            clip.start === master.start &&
            clip.duration === master.duration &&
            clip.speed === master.speed,
        ),
    ).toBe(true);
  }
});

it("动态背景镜头随变速缩放，变速后新建或替换背景不会再次缩放镜头", () => {
  const project = fixture();
  const bg = project.clips.find((clip) => clip.recordingRole === "background")!;
  bg.keyframes = [
    { time: 0, value: bg.transform },
    { time: 4, value: { ...bg.transform, scale: 2 } },
  ];
  project.clips[0] = setClipSpeed(project.clips[0], 2);
  const synced = syncRecordingTiming(project);
  expect(
    synced.clips.find((clip) => clip.id === bg.id)!.keyframes[1].time,
  ).toBe(2);
  const disabled = updateRecordingObject(synced, project.clips[0].id, {
    background: false,
  });
  const enabled = updateRecordingObject(
    disabled,
    project.clips[0].id,
    { background: true },
    project.assets.find((asset) => asset.id === "bg"),
  );
  const backdrop = enabled.clips.find(
    (clip) => clip.recordingRole === "background",
  )!;
  expect(backdrop).toMatchObject({ start: 1, duration: 2, speed: 2 });
  expect(syncRecordingTiming(enabled)).toBe(enabled);
});

it("真实截图和视频导出在录屏结束后不残留背景", async () => {
  const root = path.resolve(`test-output/recording-timing-${Date.now()}`);
  await fs.mkdir(root, { recursive: true });
  const screen = path.join(root, "screen.mp4"),
    bg = path.join(root, "bg.png");
  await runProcess(findBinary("ffmpeg"), [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=blue:s=160x90:r=10:d=4",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    screen,
  ]);
  await sharp({
    create: { width: 160, height: 90, channels: 3, background: "#ff0000" },
  })
    .png()
    .toFile(bg);
  const base = fixture();
  base.clips = base.clips.filter((clip) =>
    ["screen", "background"].includes(clip.recordingRole!),
  );
  base.assets = base.assets.map((asset) => ({
    ...asset,
    path: asset.id === "bg" ? bg : screen,
  }));
  base.clips[0] = setClipSpeed(base.clips[0], 2);
  const tail = { ...newText("titles", 4), duration: 0.5 };
  base.clips.push(tail);
  const project = syncRecordingTiming(base);
  project.exportSettings = { encoder: "software" };
  const signal = AbortSignal.timeout(30000);
  const corner = async (file: string) =>
    Array.from(
      (await sharp(file).removeAlpha().raw().toBuffer()).subarray(0, 3),
    );
  for (const [time, color] of [
    [0.5, [0, 0, 0]],
    [1.5, [255, 0, 0]],
    [3.5, [0, 0, 0]],
  ] as const) {
    const file = path.join(root, `frame-${time}.png`);
    await exportFrame(
      project,
      time,
      file,
      path.join(root, `frame-work-${time}`),
      signal,
    );
    expect(await corner(file)).toEqual(color);
  }
  const video = path.join(root, "output.mp4");
  await exportVideo(
    project,
    video,
    path.join(root, "video-work"),
    false,
    signal,
    () => {},
  );
  const after = path.join(root, "after.png");
  await runProcess(findBinary("ffmpeg"), [
    "-y",
    "-ss",
    "3.5",
    "-i",
    video,
    "-frames:v",
    "1",
    after,
  ]);
  expect((await corner(after)).every((channel) => channel < 5)).toBe(true);
}, 30000);
