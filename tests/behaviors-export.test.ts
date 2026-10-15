import { expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";
import { createProject, newText } from "../shared/model";
import { createBehavior } from "../shared/behaviors";
import { exportFrame, exportVideo } from "../electron/export";
import { findBinary, runProcess } from "../electron/process";
import { saveProject, openProject } from "../electron/project-store";

async function whitePixels(image: string) {
  const { data, info } = await sharp(image)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let count = 0;
  for (let i = 0; i < data.length; i += info.channels)
    if (data[i] > 180 && data[i + 1] > 180 && data[i + 2] > 180) count++;
  return count;
}
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
    counts.push(await whitePixels(image));
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
    clip.behaviors = [createBehavior("fade", clip.duration)!];
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
