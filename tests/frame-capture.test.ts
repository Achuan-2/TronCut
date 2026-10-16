import { expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  createProject,
  defaultTransform,
  newText,
  type Clip,
} from "../shared/model";
import { frameSnapshot } from "../shared/frame-snapshot";
import { exportFrame } from "../electron/export";
import { probeMedia } from "../electron/media";
import { findBinary, runProcess } from "../electron/process";
import * as mediaProcess from "../electron/process";
import { saveProject, openProject } from "../electron/project-store";

it("截帧冻结当前动画、裁剪、淡入与运镜，按变速后的源时间取帧且不修改工程", () => {
  const project = createProject();
  const clip: Clip = {
    ...newText("video", 4),
    kind: "video",
    sourceIn: 0.5,
    speed: 2,
    duration: 4,
    fadeIn: 2,
    animationOffset: 1,
    keyframes: [
      { time: 0, value: defaultTransform },
      {
        time: 4,
        value: { ...defaultTransform, x: 0.9, contentScale: 3, cropLeft: 0.4 },
        easing: "linear",
      },
    ],
  };
  project.clips = [
    clip,
    { ...clip, id: "hidden", trackId: "hidden" },
    { ...clip, id: "later", start: 6 },
  ];
  project.tracks.push({
    id: "hidden",
    name: "轨道3",
    hidden: true,
    locked: false,
    muted: false,
  });
  project.camera = {
    transform: { ...defaultTransform, opacity: 1 },
    keyframes: [
      { time: 5, value: { ...defaultTransform, scale: 2, opacity: 1 } },
    ],
  };
  const original = JSON.stringify(project);
  const snapshot = frameSnapshot(project, 5);
  expect(snapshot.clips).toHaveLength(1);
  expect(snapshot.clips[0]).toMatchObject({
    start: 0,
    sourceIn: 2.5,
    speed: 1,
    duration: 1 / project.canvas.fps,
    keyframes: [],
    fadeIn: 0,
    fadeOut: 0,
    transform: { x: 0.7, contentScale: 2, cropLeft: 0.2, opacity: 0.5 },
  });
  expect(snapshot.camera?.transform.scale).toBe(2);
  expect(snapshot.camera?.keyframes).toEqual([]);
  expect(JSON.stringify(project)).toBe(original);
  expect(frameSnapshot(project, 8).clips).toHaveLength(1); // The later clip remains visible.
  expect(frameSnapshot(project, 8, clip.id).clips).toHaveLength(2);
  expect(frameSnapshot(project, 10).clips).toHaveLength(0);
});

it("真实截帧按源时间合成视频、文字、裁剪和背景为 PNG，支持空画布及归档重开", async () => {
  const root = path.resolve("test-output/frame-capture");
  await fs.mkdir(root, { recursive: true });
  const video = path.join(root, "source.mp4");
  await runProcess(findBinary("ffmpeg"), [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=80x60:r=10:d=2",
    "-f",
    "lavfi",
    "-i",
    "color=c=lime:s=80x60:r=10:d=4",
    "-filter_complex",
    "[0:v][1:v]concat=n=2:v=1:a=0[v]",
    "-map",
    "[v]",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    video,
  ]);
  const project = createProject();
  project.canvas = { width: 200, height: 120, fps: 10, background: "#5432b2" };
  const asset = await probeMedia(video);
  project.assets = [asset];
  const clip: Clip = {
    ...newText("video", 4),
    kind: "video",
    assetId: asset.id,
    sourceIn: 0.5,
    speed: 2,
    duration: 2,
    transform: { ...defaultTransform, scale: 0.5 },
    keyframes: [
      {
        time: 0,
        value: { ...defaultTransform, scale: 0.5, x: 0.25, cropLeft: 0 },
      },
      {
        time: 2,
        value: { ...defaultTransform, scale: 0.5, x: 0.75, cropLeft: 0.25 },
        easing: "linear",
      },
    ],
  };
  const text = newText("titles", 4, 0, "当前帧");
  text.style = { ...text.style!, fontSize: 20, outlineWidth: 0 };
  text.textBox = { width: 100, height: 30 };
  text.transform = { ...defaultTransform, y: 0.15 };
  project.clips = [clip, text];
  const pixel = async (file: string, x: number, y: number) => [
    ...(await sharp(file)
      .extract({ left: x, top: y, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer()),
  ];
  const capture = async (time: number, endpointClipId?: string) => {
    const target = path.join(root, `frame-${time}.png`);
    await exportFrame(
      project,
      time,
      target,
      path.join(root, `work-${time}`),
      new AbortController().signal,
      undefined,
      endpointClipId,
    );
    const info = await sharp(target).metadata();
    expect([info.format, info.width, info.height]).toEqual(["png", 200, 120]);
    return target;
  };
  const first = await capture(4);
  expect((await pixel(first, 50, 60))[0]).toBeGreaterThan(230);
  const middle = await capture(5);
  expect((await pixel(middle, 100, 60))[1]).toBeGreaterThan(230);
  expect(await pixel(middle, 62, 60)).toEqual([84, 50, 178]); // Animated crop hides the left edge.
  expect(await pixel(middle, 5, 5)).toEqual([84, 50, 178]);
  const letters = await sharp(middle)
    .extract({ left: 50, top: 0, width: 100, height: 30 })
    .removeAlpha()
    .raw()
    .toBuffer();
  expect(
    [...letters].filter((channel) => channel > 230).length,
  ).toBeGreaterThan(50);
  // The recorded cursor and click ring must be sampled at the original source
  // timestamp, even though the composition has been reduced to a single frame.
  asset.cursor = {
    samples: [{ time: 2.5, x: 0.5, y: 0.5, visible: true, click: true }],
  };
  clip.cursorStyle = {
    style: "circle",
    size: 16,
    color: "#0000ff",
    clicks: true,
    smooth: false,
  };
  const cursorFrame = await capture(5.1);
  const cursorPixels = await sharp(cursorFrame)
    .extract({ left: 85, top: 40, width: 40, height: 40 })
    .removeAlpha()
    .raw()
    .toBuffer();
  let blue = 0;
  for (let i = 0; i < cursorPixels.length; i += 3)
    if (cursorPixels[i + 2] > 100 && cursorPixels[i] < 30) blue++;
  expect(blue).toBeGreaterThan(100); // Includes the ring outside the cursor itself.
  clip.sourceIn = 2; // Endpoint now lands at source EOF, where accurate seek yields no frame.
  project.canvas.fps = 30; // Source video is 10 fps.
  const endpoint = await capture(6, clip.id);
  expect((await pixel(endpoint, 150, 60))[1]).toBeGreaterThan(230);
  // Reproduce the CI demuxer returning an empty tail probe. The full scan must
  // still resolve the real 10 fps endpoint while the canvas uses 30 fps.
  const runProcessOriginal = mediaProcess.runProcess;
  let emptyTail = false;
  const processSpy = vi.spyOn(mediaProcess, "runProcess")
    .mockImplementation((binary, args, options) => {
      if (args.includes("-show_frames") && args.includes("-read_intervals")) {
        emptyTail = true;
        return Promise.resolve("");
      }
      return runProcessOriginal(binary, args, options);
    });
  try {
    const recovered = await capture(6, clip.id);
    expect(emptyTail).toBe(true);
    expect((await pixel(recovered, 150, 60))[1]).toBeGreaterThan(230);
  } finally {
    processSpy.mockRestore();
  }
  project.canvas.width = 201;
  const empty = path.join(root, "empty.png");
  await exportFrame(
    project,
    10,
    empty,
    path.join(root, "work-empty"),
    new AbortController().signal,
  );
  expect((await sharp(empty).metadata()).width).toBe(201);
  expect(await pixel(empty, 100, 60)).toEqual([84, 50, 178]);
  const captured = await probeMedia(middle);
  project.assets.push(captured);
  project.clips.push({
    ...newText("video", 5),
    kind: "image",
    assetId: captured.id,
    name: "当前帧",
  });
  const file = path.join(root, "saved", "capture.troncut");
  await saveProject(project, file);
  const reopened = await openProject(file);
  const image = reopened.assets.find((item) => item.id === captured.id)!;
  expect(image.missing).toBe(false);
  expect(path.dirname(image.path)).toBe(path.join(root, "saved", "media"));
  expect(await pixel(image.path, 100, 60)).toEqual(
    await pixel(middle, 100, 60),
  );
}, 30000);
