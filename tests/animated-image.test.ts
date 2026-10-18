import { expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { probeMedia } from "../electron/media";
import { PreviewProxyService } from "../electron/preview-proxies";
import { runProcess, findBinary } from "../electron/process";
import { addMediaAssets } from "../shared/editor";
import { createProject } from "../shared/model";
import { splitSelection } from "../shared/timeline";
import { trimClip } from "../shared/clip-trim";
import { saveProject, openProject } from "../electron/project-store";
import { exportVideo } from "../electron/export";

it("GIF 保留原动画，拆分后可延长循环，预览代理和归档导出都保持运动", async () => {
  const root = path.resolve(`test-output/animated-image-${Date.now()}`);
  await fs.mkdir(root, { recursive: true });
  const file = path.join(root, "red-blue.gif");
  await runProcess(findBinary("ffmpeg"), [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=red:s=64x48:r=10:d=0.2",
    "-f",
    "lavfi",
    "-i",
    "color=blue:s=64x48:r=10:d=0.2",
    "-filter_complex",
    "[0:v][1:v]concat=n=2:v=1:a=0",
    "-loop",
    "0",
    file,
  ]);
  const asset = await probeMedia(file);
  expect(asset).toMatchObject({
    kind: "video",
    animated: true,
    width: 64,
    height: 48,
    duration: 0.4,
  });
  const service = new PreviewProxyService(
    path.join(root, "proxy"),
    undefined,
    () => {},
  );
  service.request(asset);
  try {
    await expect
      .poll(() => service.path(asset.id), { timeout: 10000 })
      .toBeTruthy();
    const proxy = await probeMedia(service.path(asset.id)!);
    expect(proxy).toMatchObject({ kind: "video", width: 64, height: 48 });
    expect(proxy.duration).toBeCloseTo(0.4, 1);
  } finally {
    service.dispose();
  }
  const base = createProject("GIF");
  base.canvas = { width: 64, height: 48, fps: 10, background: "#ffffff" };
  base.exportSettings = { encoder: "software" };
  const added = addMediaAssets(base, [asset], 0, true);
  expect(added.clips[0].loop).toBe(true);
  const split = splitSelection(added, [added.clips[0].id], 0.2);
  split.clips[1] = trimClip(split.clips[1], asset, "right", 3, 10);
  const archive = path.join(root, "animated.troncut");
  await saveProject(split, archive);
  const reopened = await openProject(archive);
  expect(reopened.assets[0].animated).toBe(true);
  expect(reopened.clips[1]).toMatchObject({
    loop: true,
    duration: 3,
    sourceIn: 0.2,
  });
  const video = path.join(root, "animated.mp4");
  await exportVideo(
    reopened,
    video,
    path.join(root, "render"),
    false,
    AbortSignal.timeout(20000),
    () => {},
  );
  const colors: number[][] = [];
  for (const time of [0.25, 0.45, 2.65]) {
    const frame = path.join(root, `${time}.png`);
    await runProcess(findBinary("ffmpeg"), [
      "-y",
      "-ss",
      String(time),
      "-i",
      video,
      "-frames:v",
      "1",
      frame,
    ]);
    const { data, info } = await sharp(frame)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const index = (24 * info.width + 32) * info.channels;
    colors.push([...data.subarray(index, index + 3)]);
  }
  expect(colors[0][2]).toBeGreaterThan(200);
  expect(colors[1][0]).toBeGreaterThan(200);
  expect(colors[2][2]).toBeGreaterThan(200);
}, 30000);
