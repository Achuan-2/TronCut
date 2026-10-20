import { expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";
import { createProject, newText } from "../shared/model";
import { createBehavior, phaseSeconds } from "../shared/behaviors";
import { exportFrame, exportVideo } from "../electron/export";
import { findBinary, runProcess } from "../electron/process";
import { saveProject, openProject } from "../electron/project-store";

it("浮现的真实截帧复现参考关键帧的平移和淡入淡出", async () => {
  const root = path.resolve(`test-output/behavior-float-${Date.now()}`);
  await fs.mkdir(root, { recursive: true });
  const project = createProject();
  project.canvas = { width: 960, height: 540, fps: 60, background: "#000000" };
  const clip = newText("titles", 0, 0, "ABC");
  clip.duration = 2;
  clip.style = {
    ...clip.style!,
    fontSize: 44,
    outlineWidth: 0,
    fillEnabled: false,
  };
  const reference = structuredClone(clip);
  reference.keyframes = [
    {
      time: 0,
      value: { ...clip.transform, y: 0.5 + 17 / 540, opacity: 0 },
      easing: "auto",
    },
    { time: 0.85, value: { ...clip.transform }, easing: "auto" },
    { time: 1.55, value: { ...clip.transform }, easing: "auto" },
    {
      time: 2,
      value: { ...clip.transform, y: 0.5 - 8 / 540, opacity: 0 },
      easing: "auto",
    },
  ];
  clip.behaviors = [createBehavior("float", 2)!];
  const samples = [0.2125, 0.425, 0.85, 1, 1.775];
  const stats: { y: number; light: number }[][] = [];
  for (const [kind, value] of [
    ["reference", reference],
    ["float", clip],
  ] as const) {
    project.clips = [value];
    const frames: { y: number; light: number }[] = [];
    for (const time of samples) {
      const image = path.join(root, `${kind}-${time}.png`);
      await exportFrame(
        project,
        time,
        image,
        path.join(root, `${kind}-${time}`),
        AbortSignal.timeout(15000),
      );
      const { data, info } = await sharp(image)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      let light = 0,
        weightedY = 0;
      for (let y = 0; y < info.height; y++)
        for (let x = 0; x < info.width; x++) {
          const brightness = data[(y * info.width + x) * info.channels];
          light += brightness;
          weightedY += y * brightness;
        }
      frames.push({ y: weightedY / light, light });
    }
    stats.push(frames);
  }
  for (let index = 0; index < samples.length; index++) {
    const expected = stats[0][index],
      actual = stats[1][index];
    expect(
      Math.abs(actual.y - stats[1][3].y - (expected.y - stats[0][3].y)),
    ).toBeLessThan(1.5);
    expect(
      Math.abs(
        actual.light / stats[1][3].light - expected.light / stats[0][3].light,
      ),
    ).toBeLessThan(0.03);
  }
}, 45000);

async function whiteBounds(image: string) {
  const { data, info } = await sharp(image)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let left = info.width,
    right = -1,
    top = info.height,
    bottom = -1;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      const pixel = (y * info.width + x) * info.channels;
      if (data[pixel] > 180 && data[pixel + 1] > 180 && data[pixel + 2] > 180) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  return {
    width: Math.max(0, right - left + 1),
    height: Math.max(0, bottom - top + 1),
  };
}

it("文本和图片的弹出在真实输出中沿边缘翻起，不再等比缩小", async () => {
  const root = path.resolve(`test-output/behavior-hinge-${Date.now()}`);
  await fs.mkdir(root, { recursive: true });
  const source = path.join(root, "source.png");
  await sharp({
    create: { width: 80, height: 40, channels: 3, background: "#ffffff" },
  })
    .png()
    .toFile(source);
  for (const kind of ["text", "image"] as const) {
    const project = createProject();
    project.canvas = {
      width: 320,
      height: 180,
      fps: 30,
      background: "#000000",
    };
    const clip = { ...newText("titles", 0, 0, "ABC"), kind };
    clip.style = {
      ...clip.style!,
      fontSize: 40,
      outlineWidth: 0,
      fillEnabled: false,
    };
    if (kind === "image") {
      project.assets = [
        {
          id: "image",
          name: "image",
          path: source,
          kind,
          width: 80,
          height: 40,
          duration: 0,
          hasAudio: false,
        },
      ];
      clip.assetId = "image";
      clip.transform.scale = 0.3;
    }
    const behavior = createBehavior("pop", 5, kind)!;
    behavior.incoming.type = kind === "text" ? "simultaneous" : "whole";
    behavior.incoming.offset = 0;
    behavior.during.style = "none";
    behavior.outgoing.style = "none";
    clip.behaviors = [behavior];
    project.clips = [clip];
    const bounds = [];
    for (const time of [
      Math.min(0.1, phaseSeconds(behavior.incoming) / 10),
      1,
    ]) {
      const image = path.join(root, `${kind}-${time}.png`);
      await exportFrame(
        project,
        time,
        image,
        path.join(root, `${kind}-${time}`),
        AbortSignal.timeout(15000),
      );
      bounds.push(await whiteBounds(image));
    }
    expect(bounds[0].width).toBeGreaterThan(bounds[1].width * 0.8);
    expect(bounds[0].height).toBeGreaterThan(0);
    expect(bounds[0].height).toBeLessThan(bounds[1].height * 0.6);
  }
}, 45000);

async function whitePixels(image: string, threshold = 180) {
  const { data, info } = await sharp(image)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let count = 0;
  for (let i = 0; i < data.length; i += info.channels)
    if (
      data[i] > threshold &&
      data[i + 1] > threshold &&
      data[i + 2] > threshold
    )
      count++;
  return count;
}
async function whiteCenter(image: string, axis: "x" | "y" = "x") {
  const { data, info } = await sharp(image)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0,
    count = 0;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++)
      if (data[(y * info.width + x) * info.channels] > 180) {
        sum += axis === "x" ? x : y;
        count++;
      }
  expect(count).toBeGreaterThan(20);
  return sum / count;
}
it("切换的对象平移和文本同时平移真实写入视频，参数可保存重开", async () => {
  const root = path.resolve(`test-output/shifting-${Date.now()}`);
  await fs.mkdir(root, { recursive: true });
  const source = path.join(root, "source.png"),
    movie = path.join(root, "source.mp4");
  await sharp({
    create: { width: 40, height: 30, channels: 3, background: "#ffffff" },
  })
    .png()
    .toFile(source);
  await runProcess(findBinary("ffmpeg"), [
    "-y",
    "-loop",
    "1",
    "-i",
    source,
    "-t",
    "2",
    "-r",
    "10",
    "-pix_fmt",
    "yuv420p",
    movie,
  ]);
  for (const kind of ["video", "text"] as const) {
    const project = createProject();
    project.canvas = {
      width: 320,
      height: 180,
      fps: 10,
      background: "#000000",
    };
    project.exportSettings = { encoder: "software" };
    if (kind === "video")
      project.assets = [
        {
          id: "source",
          name: "source",
          path: movie,
          kind,
          width: 40,
          height: 30,
          duration: 2,
          hasAudio: false,
        },
      ];
    const clip = {
      ...newText("video", 0, 0, "ABC"),
      kind,
      ...(kind === "video" ? { assetId: "source" } : {}),
      duration: 2,
    };
    clip.style = { ...clip.style!, fontSize: 40, outlineWidth: 0 };
    clip.transform.scale = kind === "video" ? 0.25 : 1;
    const behavior = createBehavior("cut", 2, kind)!;
    behavior.incoming.style = "none";
    behavior.outgoing.style = "none";
    behavior.during.shift = 80;
    behavior.during.loopTime = 1;
    behavior.during.easing = "linear";
    clip.behaviors = [behavior];
    project.clips = [clip];
    const file = path.join(root, kind, "project.troncut");
    await saveProject(project, file);
    const reopened = await openProject(file);
    expect(reopened.clips[0].behaviors).toEqual(clip.behaviors);
    const output = path.join(root, kind, "shift.mp4");
    await exportVideo(
      reopened,
      output,
      path.join(root, kind, "render"),
      false,
      AbortSignal.timeout(25000),
      () => {},
    );
    const centers: number[] = [];
    for (const time of [0.2, 0.7]) {
      const image = path.join(root, kind, `frame-${time}.png`);
      await runProcess(findBinary("ffmpeg"), [
        "-y",
        "-ss",
        String(time),
        "-i",
        output,
        "-frames:v",
        "1",
        image,
      ]);
      centers.push(await whiteCenter(image, "y"));
    }
    expect(Math.abs(centers[0] - centers[1])).toBeGreaterThan(15);
    const capture = path.join(root, kind, "capture.png");
    await exportFrame(
      reopened,
      0.7,
      capture,
      path.join(root, kind, "capture"),
      AbortSignal.timeout(10000),
    );
    // Video chroma conversion and still rasterization may differ by one pixel.
    expect(
      Math.abs((await whiteCenter(capture, "y")) - centers[1]),
    ).toBeLessThanOrEqual(1.5);
  }
}, 60000);
it("逐字行为可保存重开，实际导出逐字出现，截帧保留当前阶段", async () => {
  const root = path.resolve(`test-output/behaviors-text-${Date.now()}`);
  const project = createProject();
  project.canvas = { width: 240, height: 120, fps: 10, background: "#000000" };
  project.exportSettings = { encoder: "software" };
  const clip = newText("titles", 0, 0, "ABC");
  clip.duration = 1.6;
  clip.style = { ...clip.style!, fontSize: 32, outlineWidth: 0 };
  const behavior = createBehavior("type-reveal", clip.duration)!;
  behavior.incoming.offset = 0.2;
  behavior.outgoing.style = "none";
  clip.behaviors = [behavior];
  project.clips = [clip];
  await saveProject(project, path.join(root, "behavior.troncut"));
  const reopened = await openProject(path.join(root, "behavior.troncut"));
  expect(reopened.clips[0].behaviors).toEqual(clip.behaviors);
  const video = path.join(root, "behavior.mp4");
  await exportVideo(
    reopened,
    video,
    path.join(root, "render"),
    false,
    AbortSignal.timeout(30000),
    () => {},
  );
  const counts: number[] = [];
  for (const time of [0, 0.1, 0.5, 1.4]) {
    const image = path.join(root, `frame-${time}.png`);
    await runProcess(findBinary("ffmpeg"), [
      "-y",
      "-ss",
      String(time),
      "-i",
      video,
      "-frames:v",
      "1",
      image,
    ]);
    counts.push(await whitePixels(image, 20));
  }
  expect(counts[0]).toBe(0);
  expect(counts[1]).toBeGreaterThan(20);
  expect(counts[2]).toBeGreaterThan(counts[1] * 2);
  expect(counts[3]).toBeGreaterThan(counts[1] * 2);
  const snapshot = path.join(root, "snapshot.png");
  await exportFrame(
    reopened,
    0.1,
    snapshot,
    path.join(root, "capture"),
    AbortSignal.timeout(15000),
  );
  expect(await whitePixels(snapshot)).toBeLessThan(counts[2] * 0.6);
}, 45000);

it("图片和视频使用对象行为，实际导出包含入场与出场透明度", async () => {
  const root = path.resolve(`test-output/behaviors-media-${Date.now()}`);
  await fs.mkdir(root, { recursive: true });
  const source = path.join(root, "source.png"),
    movie = path.join(root, "source.mp4");
  await sharp({
    create: { width: 40, height: 30, channels: 3, background: "#ffffff" },
  })
    .png()
    .toFile(source);
  await runProcess(findBinary("ffmpeg"), [
    "-y",
    "-loop",
    "1",
    "-i",
    source,
    "-t",
    "1.2",
    "-r",
    "10",
    "-pix_fmt",
    "yuv420p",
    movie,
  ]);
  for (const kind of ["image", "video"] as const) {
    const project = createProject();
    project.canvas = { width: 160, height: 90, fps: 10, background: "#000000" };
    project.exportSettings = { encoder: "software" };
    project.assets = [
      {
        id: "source",
        name: "source",
        path: kind === "image" ? source : movie,
        kind,
        width: 40,
        height: 30,
        duration: kind === "image" ? 0 : 1.2,
        hasAudio: false,
      },
    ];
    const clip = {
      ...newText("video", 0),
      kind,
      assetId: "source",
      duration: 1.2,
    };
    clip.transform.scale = 0.5;
    clip.behaviors = [createBehavior("fade", clip.duration, kind)!];
    project.clips = [clip];
    const output = path.join(root, `${kind}.mp4`);
    await exportVideo(
      project,
      output,
      path.join(root, kind),
      false,
      AbortSignal.timeout(20000),
      () => {},
    );
    const counts: number[] = [];
    for (const time of [0, 0.6, 1.1]) {
      const image = path.join(root, `${kind}-${time}.png`);
      await runProcess(findBinary("ffmpeg"), [
        "-y",
        "-ss",
        String(time),
        "-i",
        output,
        "-frames:v",
        "1",
        image,
      ]);
      counts.push(await whitePixels(image));
    }
    expect(counts[0]).toBe(0);
    expect(counts[1]).toBeGreaterThan(100);
    expect(counts[2]).toBeLessThan(counts[1] / 2);
  }
}, 45000);
