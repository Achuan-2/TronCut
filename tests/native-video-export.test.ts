import { expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createProject, newText } from "../shared/model";
import { exportVideo } from "../electron/export";
import { probeMedia } from "../electron/media";
import { findBinary, runProcess } from "../electron/process";

it("保留原生像素格式的导出路径仍正确混合带透明通道的视频", async () => {
  const root = path.resolve(`test-output/native-video-${Date.now()}`);
  await fs.mkdir(root, { recursive: true });
  const source = path.join(root, "transparent.mov");
  await runProcess(findBinary("ffmpeg"), [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x00ff00@0.5:s=80x60:r=10:d=0.6,format=rgba",
    "-c:v",
    "qtrle",
    "-pix_fmt",
    "argb",
    source,
  ]);
  const project = createProject();
  project.canvas = { width: 160, height: 90, fps: 10, background: "#ff0000" };
  project.exportSettings = { encoder: "software" };
  const asset = await probeMedia(source);
  project.assets = [asset];
  project.clips = [
    { ...newText("video", 0), kind: "video", assetId: asset.id, duration: 0.6 },
  ];
  const target = path.join(root, "export.mp4");
  await exportVideo(
    project,
    target,
    path.join(root, "render"),
    false,
    AbortSignal.timeout(15000),
    () => {},
  );
  const png = path.join(root, "frame.png");
  await runProcess(findBinary("ffmpeg"), [
    "-y",
    "-i",
    target,
    "-frames:v",
    "1",
    png,
  ]);
  const pixel = await sharp(png)
    .extract({ left: 80, top: 45, width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer();
  expect(Math.abs(pixel[0] - 128)).toBeLessThan(6);
  expect(Math.abs(pixel[1] - 127)).toBeLessThan(6);
  expect(pixel[2]).toBeLessThan(6);
});
