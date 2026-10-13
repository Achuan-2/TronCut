import { expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";
import { createProject, newText, type Clip } from "../shared/model";
import { setKeyframeTransform } from "../shared/editor";
import { exportVideo } from "../electron/export";
import { saveProject, openProject } from "../electron/project-store";
import { runProcess, findBinary } from "../electron/process";

it("保存重开和真实导出保留左侧起点，只有终点向右并旋转", async () => {
  const root = path.resolve(`test-output/keyframe-edit-${Date.now()}`);
  await fs.mkdir(root, { recursive: true });
  const image = path.join(root, "green.png");
  await sharp({
    create: { width: 50, height: 20, channels: 3, background: "#00ff00" },
  })
    .png()
    .toFile(image);
  const project = createProject();
  project.canvas = { width: 160, height: 90, fps: 10, background: "#000000" };
  project.exportSettings = { encoder: "software" };
  project.assets = [
    {
      id: "image",
      path: image,
      name: "green.png",
      kind: "image",
      width: 50,
      height: 20,
      duration: 0,
      hasAudio: false,
    },
  ];
  const clip: Clip = {
    ...newText("titles", 0),
    kind: "image",
    assetId: "image",
    duration: 1,
    transform: { x: 0.25, y: 0.5, scale: 0.25, opacity: 1 },
    keyframes: [],
  };
  clip.keyframes = [
    { time: 0, value: { ...clip.transform } },
    { time: 1, value: { ...clip.transform } },
  ];
  project.clips = [setKeyframeTransform(clip, { x: 0.75, rotation: 90 }, 1)];
  const file = path.join(root, "edit.troncut");
  await saveProject(project, file);
  const reopened = await openProject(file);
  expect(reopened.clips[0].keyframes[0].value.x).toBe(0.25);
  expect(reopened.clips[0].keyframes[1].value.x).toBe(0.75);
  const output = path.join(root, "edit.mp4");
  await exportVideo(
    reopened,
    output,
    path.join(root, "render"),
    false,
    new AbortController().signal,
    () => {},
  );
  const boxes: { width: number; height: number; center: number }[] = [];
  for (const [i, time] of [0, 0.9].entries()) {
    const frame = path.join(root, `frame-${i}.png`);
    await runProcess(findBinary("ffmpeg"), [
      "-y",
      "-ss",
      String(time),
      "-i",
      output,
      "-frames:v",
      "1",
      frame,
    ]);
    const { data, info } = await sharp(frame)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const xs: number[] = [],
      ys: number[] = [];
    for (let y = 0; y < info.height; y++)
      for (let x = 0; x < info.width; x++) {
        const index = (y * info.width + x) * info.channels;
        if (data[index + 1] > 150 && data[index + 1] > data[index] * 2) {
          xs.push(x);
          ys.push(y);
        }
      }
    expect(xs.length).toBeGreaterThan(100);
    boxes.push({
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
      center: (Math.max(...xs) + Math.min(...xs)) / 2,
    });
  }
  expect(boxes[0].center).toBeCloseTo(40, -1);
  expect(boxes[1].center).toBeGreaterThan(boxes[0].center + 65);
  expect(boxes[1].height).toBeGreaterThan(boxes[0].height * 1.8);
  expect(boxes[1].width).toBeLessThan(boxes[0].width * 0.6);
}, 30000);
