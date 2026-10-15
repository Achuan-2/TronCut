import { expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createProject, newText, validateProject, type Clip } from "../shared/model";
import { addMediaFrame, mediaFrameRadii } from "../shared/media-frame";
import { localDelta, projectDelta, depthScale } from "../shared/rotation";
import { setTransform, transformAt, setKeyframeTransform } from "../shared/editor";
import { animationRanges, sameTransform } from "../shared/animation-ranges";
import { snapshotAnimation, pasteAnimation } from "../shared/animation-edit";
import { exportFrame } from "../electron/export";
import { probeMedia } from "../electron/media";
import { openProject, saveProject } from "../electron/project-store";

it("倾斜、深度与三轴旋转组合后拖拽可逆，关键帧缺省、端点编辑和动画复制一致", () => {
  const value = { ...newText("titles", 0).transform, skew: 35, z: 400, rotation: 28, rotationX: 20, rotationY: -40 };
  const delta = { x: 37, y: -21 };
  const restored = localDelta(value, projectDelta(value, delta));
  expect(restored.x).toBeCloseTo(delta.x, 9);
  expect(restored.y).toBeCloseTo(delta.y, 9);
  expect(depthScale(0)).toBe(1);
  expect(depthScale(1000)).toBe(2);
  const clip = setTransform(newText("titles", 0), { skew: 40, z: 600 }, 2, true, 2);
  expect(transformAt(clip, 0).skew).toBe(0);
  expect(transformAt(clip, 1).skew).toBe(20);
  expect(transformAt(clip, 1).z).toBe(300);
  expect(animationRanges(clip)).toHaveLength(1);
  expect(sameTransform(clip.transform, { ...clip.transform, skew: 1 })).toBe(false);
  expect(sameTransform(clip.transform, { ...clip.transform, z: 1 })).toBe(false);
  const edited = setKeyframeTransform(clip, { skew: -20, z: -200 }, 2);
  expect(transformAt(edited, 0).skew).toBe(0);
  expect(transformAt(edited, 2)).toMatchObject({ skew: -20, z: -200 });
  const copied = snapshotAnimation(clip, animationRanges(clip)[0])!;
  const pasted = pasteAnimation(clip, copied, 3);
  expect(transformAt(pasted, 5)).toMatchObject({ skew: 80, z: 1000 });
});

it("圆角作为可选效果添加且不重复，旧工程保留圆角，关闭不丢失半径和角设置", () => {
  const clip: Clip = { ...newText("video", 0), kind: "image" };
  expect(clip.mediaFrame).toBeUndefined();
  const applied = addMediaFrame(clip);
  expect(mediaFrameRadii(applied)).toEqual([20, 20, 20, 20]);
  expect(addMediaFrame(applied)).toBe(applied);
  expect(addMediaFrame(newText("titles", 0)).mediaFrame).toBeUndefined();
  const legacy = { ...clip, mediaFrame: { radius: 33 } };
  expect(mediaFrameRadii(legacy)).toEqual([33, 33, 33, 33]);
  const disabled = { ...applied, mediaFrame: { ...applied.mediaFrame!, enabled: false } };
  const reopened = validateProject({ ...createProject(), clips: [disabled] }).clips[0];
  expect(reopened.mediaFrame).toEqual(disabled.mediaFrame);
  expect(mediaFrameRadii(reopened)).toEqual([0, 0, 0, 0]);
});

it("真实导出单角、关闭圆角及倾斜/深度/旋转关键帧，保存重开保持属性", async () => {
  const root = path.resolve(`test-output/frame-properties-${Date.now()}`);
  await fs.mkdir(root, { recursive: true });
  const source = path.join(root, "green.png");
  await sharp({ create: { width: 200, height: 100, channels: 3, background: "#00c800" } }).png().toFile(source);
  const asset = await probeMedia(source);
  const project = createProject("画面属性");
  project.canvas = { width: 320, height: 180, fps: 10, background: "#5432b2" };
  project.assets = [asset];
  const base: Clip = { ...newText("video", 0), kind: "image", assetId: asset.id, duration: 1, transform: { x: 0.5, y: 0.5, scale: 0.5, opacity: 1 } };
  const corners = { topLeft: true, topRight: false, bottomRight: false, bottomLeft: false };
  const states: Clip[] = [
    { ...base, mediaFrame: { radius: 40, enabled: true, corners } },
    { ...base, mediaFrame: { radius: 40, enabled: false, corners } },
    { ...base, transform: { ...base.transform, skew: 30 } },
    { ...base, transform: { ...base.transform, skew: -25, rotationX: 20, rotationY: 15, rotation: 20, z: 500 } },
    { ...base, keyframes: [{ time: 0, value: base.transform }, { time: 1, value: { ...base.transform, skew: 60, z: 600 }, easing: "linear" }] },
  ];
  for (const [index, clip] of states.entries()) {
    project.clips = [clip];
    const file = path.join(root, `${index}.troncut`);
    await saveProject(project, file);
    const reopened = await openProject(file);
    expect(reopened.clips[0].transform).toEqual(clip.transform);
    expect(reopened.clips[0].mediaFrame).toEqual(clip.mediaFrame);
    const output = path.join(root, `${index}.png`);
    await exportFrame(reopened, 0.5, output, path.join(root, `render-${index}`), AbortSignal.timeout(20000));
    const { data, info } = await sharp(output).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
    const green = (x: number, y: number) => { const color = pixel(x, y); expect(color[1]).toBeGreaterThan(185); expect(color[0]).toBeLessThan(15); };
    const background = (x: number, y: number) => pixel(x, y).forEach((channel, i) => expect(Math.abs(channel - [84, 50, 178][i])).toBeLessThan(5));
    if (index === 0) { background(82, 52); green(237, 52); green(82, 127); }
    if (index === 1) { green(82, 52); green(237, 52); }
    if (index === 2) { green(75, 60); background(245, 60); green(245, 120); background(85, 120); }
    if (index >= 3) {
      const pose = transformAt(clip, 0.5);
      for (const point of [{ x: -50, y: -25 }, { x: 50, y: 25 }]) {
        const projected = projectDelta(pose, point);
        green(Math.round(160 + projected.x), Math.round(90 + projected.y));
      }
      background(5, 5);
    }
  }
}, 30000);
