import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createProject, defaultTransform, type Clip } from "../shared/model";
import { setCameraTransform } from "../shared/canvas";
import { probeMedia } from "../electron/media";
import { exportVideo } from "../electron/export";
import { findBinary, runProcess } from "../electron/process";
import { openProject, saveProject } from "../electron/project-store";

describe("整幅画面的真实运镜导出", () => {
  it("不同时间的缩放平移作用于合成后的所有图层，保存重开保留关键帧", async () => {
    const root = path.resolve(`test-output/camera-export-${Date.now()}`);
    await fs.mkdir(root, { recursive: true });
    const source = path.join(root, "左右色块.png");
    const blue = await sharp({
      create: { width: 80, height: 90, channels: 3, background: "#0000ff" },
    })
      .png()
      .toBuffer();
    await sharp({
      create: { width: 160, height: 90, channels: 3, background: "#ff0000" },
    })
      .composite([{ input: blue, left: 80, top: 0 }])
      .png()
      .toFile(source);
    const asset = await probeMedia(source);
    let project = createProject("运镜导出");
    project.canvas = { width: 160, height: 90, fps: 10, background: "#000000" };
    project.exportSettings = { encoder: "software" };
    project.assets = [asset];
    const image: Clip = {
      id: "image",
      name: "色块",
      kind: "image",
      assetId: asset.id,
      trackId: "video",
      start: 0,
      duration: 1.2,
      sourceIn: 0,
      speed: 1,
      volume: 1,
      podcast: false,
      transform: defaultTransform,
      keyframes: [],
    };
    const shape: Clip = {
      ...image,
      id: "shape",
      name: "独立标注",
      kind: "shape",
      assetId: undefined,
      trackId: "titles",
      shape: "rectangle",
      fill: "#00ff00",
      transform: { ...defaultTransform, x: 0.75, scale: 0.05 },
    };
    project.clips = [image, shape];
    project = setCameraTransform(project, { scale: 2, x: 0.75 }, 0.8);
    project = setCameraTransform(project, { x: 0.25 }, 1);
    const file = path.join(root, "工程", "运镜.troncut");
    await saveProject(project, file);
    const reopened = await openProject(file);
    expect(reopened.camera).toEqual(project.camera);
    const output = path.join(root, "运镜.mp4");
    await exportVideo(
      reopened,
      output,
      path.join(root, "render"),
      false,
      new AbortController().signal,
      () => {},
    );
    const info = await probeMedia(output);
    expect(info.width).toBe(160);
    expect(info.height).toBe(90);
    expect(info.duration).toBeCloseTo(1.2, 1);
    await runProcess(findBinary("ffmpeg"), [
      "-y",
      "-i",
      output,
      "-vf",
      "select=eq(n\\,0)+eq(n\\,8)+eq(n\\,11)",
      "-fps_mode",
      "passthrough",
      "-frames:v",
      "3",
      path.join(root, "frame-%02d.png"),
    ]);
    const frames = await Promise.all(
      [1, 2, 3].map(async (index) => {
        const { data, info } = await sharp(
          path.join(root, `frame-0${index}.png`),
        )
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        return (x: number, y: number) => [
          ...data.subarray(
            (y * info.width + x) * info.channels,
            (y * info.width + x) * info.channels + 3,
          ),
        ];
      }),
    );
    expect(frames[0](20, 45)[0]).toBeGreaterThan(180);
    expect(frames[1](20, 45)[2]).toBeGreaterThan(180);
    expect(
      frames[1](80, 45)[1],
      "独立标注也随整个画面放大并平移到中央",
    ).toBeGreaterThan(180);
    expect(frames[2](80, 45)[0]).toBeGreaterThan(180);
    expect(frames[2](80, 45)[1]).toBeLessThan(80);
  });
});
