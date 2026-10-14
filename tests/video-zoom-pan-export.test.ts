import { expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createProject, defaultTransform, type Clip } from "../shared/model";
import { setVideoZoomPan } from "../shared/video-zoom-pan";
import { exportVideo } from "../electron/export";
import { runProcess, findBinary } from "../electron/process";
import { saveProject, openProject } from "../electron/project-store";

it("两段视频的缩放平移动画保存重开后真实导出，无画布运镜数据", async () => {
  const root = path.resolve(`test-output/video-zoom-pan-${Date.now()}`);
  await fs.mkdir(root, { recursive: true });
  const source = path.join(root, "green.mp4");
  await runProcess(findBinary("ffmpeg"), [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x00ff00:s=160x90:r=10",
    "-t",
    "2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    source,
  ]);
  let p = createProject();
  p.canvas = { width: 160, height: 90, fps: 10, background: "#000000" };
  p.exportSettings = { encoder: "software" };
  p.assets = [
    {
      id: "green",
      path: source,
      name: "green.mp4",
      kind: "video",
      duration: 2,
      width: 160,
      height: 90,
      hasAudio: false,
    },
  ];
  p.clips = [0.3, 0.7].map((x, i): Clip => ({
    id: `video-${i}`,
    trackId: i ? "titles" : "video",
    assetId: "green",
    kind: "video",
    name: "视频",
    start: 0,
    duration: 2,
    sourceIn: 0,
    speed: 1,
    volume: 1,
    podcast: false,
    transform: { ...defaultTransform, x, scale: 0.15 },
    keyframes: [],
  }));
  p = setVideoZoomPan(p, { scale: 2 }, 1.8);
  const projectFile = path.join(root, "zoom.troncut");
  await saveProject(p, projectFile);
  const reopened = await openProject(projectFile);
  expect(reopened.camera).toBeUndefined();
  expect(
    reopened.clips.every((clip) => clip.keyframes.at(-1)?.zoomPan?.scale === 2),
  ).toBe(true);
  const output = path.join(root, "zoom.mp4");
  await exportVideo(
    reopened,
    output,
    path.join(root, "render"),
    false,
    AbortSignal.timeout(20000),
    () => {},
  );
  for (const [time, centers] of [
    [0.5, [48, 112]],
    [1.8, [16, 144]],
  ] as const) {
    const png = path.join(root, `${time}.png`);
    await runProcess(findBinary("ffmpeg"), [
      "-y",
      "-ss",
      String(time),
      "-i",
      output,
      "-frames:v",
      "1",
      png,
    ]);
    const { data, info } = await sharp(png)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (const center of centers) {
      const index = (45 * info.width + center) * info.channels;
      expect(data[index + 1]).toBeGreaterThan(150);
      expect(data[index]).toBeLessThan(40);
    }
    if (time === 1.8)
      for (const oldCenter of [48, 112]) {
        const index = (45 * info.width + oldCenter) * info.channels;
        expect(data[index + 1]).toBeLessThan(40);
      }
  }
});
