import { expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { animationEasings } from "../shared/easing";
import { createProject, newText, type Clip } from "../shared/model";
import { transformAt } from "../shared/editor";
import { exportVideo } from "../electron/export";
import { saveProject, openProject } from "../electron/project-store";
import { findBinary, runProcess } from "../electron/process";

it("五种缓动保存重开后，实际输出位置与预览在两个进度点一致", async () => {
  const root = path.resolve(`test-output/easing-${Date.now()}`);
  await fs.mkdir(root, { recursive: true });
  const image = path.join(root, "green.png");
  await sharp({
    create: { width: 20, height: 20, channels: 3, background: "#00ff00" },
  })
    .png()
    .toFile(image);
  const project = createProject();
  project.canvas = { width: 200, height: 100, fps: 20, background: "#000000" };
  project.exportSettings = { encoder: "software" };
  project.assets = [
    {
      id: "green",
      path: image,
      name: "green.png",
      kind: "image",
      width: 20,
      height: 20,
      duration: 0,
      hasAudio: false,
    },
  ];
  project.clips = animationEasings.map((easing, i): Clip => {
    const from = { x: 0.2, y: 0.5, scale: 0.2, opacity: 1 };
    return {
      ...newText("titles", i * 1.25),
      kind: "image",
      assetId: "green",
      duration: 1.25,
      transform: from,
      keyframes: [
        { time: 0.1, value: from },
        { time: 1.1, value: { ...from, x: 0.7 }, easing },
      ],
    };
  });
  const file = path.join(root, "easing.troncut");
  await saveProject(project, file);
  const reopened = await openProject(file);
  expect(reopened.clips.map((clip) => clip.keyframes.at(-1)?.easing)).toEqual([
    ...animationEasings,
  ]);
  const output = path.join(root, "easing.mp4");
  await exportVideo(
    reopened,
    output,
    path.join(root, "render"),
    false,
    AbortSignal.timeout(20000),
    () => {},
  );
  for (const [i, clip] of reopened.clips.entries()) {
    for (const local of [0.35, 0.85]) {
      const frame = path.join(root, `frame-${i}-${local}.png`);
      await runProcess(findBinary("ffmpeg"), [
        "-y",
        "-ss",
        String(clip.start + local),
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
      const xs: number[] = [];
      for (let y = 0; y < info.height; y++)
        for (let x = 0; x < info.width; x++) {
          const index = (y * info.width + x) * info.channels;
          if (data[index + 1] > 150 && data[index + 1] > data[index] * 2)
            xs.push(x);
        }
      expect(
        xs.length,
        `${animationEasings[i]} ${local} visible`,
      ).toBeGreaterThan(150);
      const center = (Math.min(...xs) + Math.max(...xs)) / 2;
      expect(
        Math.abs(center - transformAt(clip, local).x * 200),
        `${animationEasings[i]} ${local} matches preview`,
      ).toBeLessThan(3);
    }
  }
});
