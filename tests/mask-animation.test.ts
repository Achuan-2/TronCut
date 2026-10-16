import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  createProject,
  newText,
  validateProject,
  type Clip,
} from "../shared/model";
import { defaultVisualEffect } from "../shared/visual-effects";
import { animateMask } from "../shared/mask-animation";
import { clearMaskChannels, hasMaskAnimation } from "../shared/mask-state";
import { visualClipAt, hasVisualAnimation } from "../shared/visual-state";
import { transformAt, changeSpeed, splitClip } from "../shared/editor";
import { animationRanges, retimeAnimation } from "../shared/animation-ranges";
import {
  addAnimationKeyframe,
  snapshotAnimation,
  pasteAnimation,
  removeAnimation,
  setAnimationEasing,
} from "../shared/animation-edit";
import { exportVideo, exportFrame } from "../electron/export";
import { probeMedia } from "../electron/media";
import { findBinary, runProcess } from "../electron/process";
import { saveProject, openProject } from "../electron/project-store";

function source(): Clip {
  return {
    ...newText("video", 0),
    kind: "shape",
    shape: "rectangle",
    fill: "#00ff00",
    duration: 3,
    visualEffects: {
      mask: {
        ...defaultVisualEffect("mask"),
        shape: "rectangle",
        x: 0.05,
        width: 0.1,
        height: 1,
        feather: 0,
      },
    },
  };
}
const maskAt = (clip: Clip, time: number) =>
  visualClipAt(clip, transformAt(clip, time)).visualEffects!.mask!;

describe("遮罩区域动画", () => {
  it("静态编辑、自动动画和端点编辑只修改遮罩，不移动素材", () => {
    const clip = source();
    const staticEdit = animateMask(
      clip,
      { width: 0.2 },
      { time: 0, auto: false },
    );
    expect(staticEdit.keyframes).toEqual([]);
    expect(maskAt(staticEdit, 0).width).toBe(0.2);
    const animated = animateMask(
      clip,
      { x: 0.5, width: 1 },
      { time: 2, auto: true },
    );
    expect(
      animationRanges(animated).map((range) => [range.start, range.end]),
    ).toEqual([[1, 2]]);
    expect(hasMaskAnimation(animated)).toBe(true);
    expect(hasVisualAnimation(animated)).toBe(false);
    expect(maskAt(animated, 0.5).width).toBe(0.1);
    expect(maskAt(animated, 1.5).width).toBeCloseTo(0.55);
    expect(maskAt(animated, 2.5).width).toBe(1);
    const start = animateMask(
      animated,
      { width: 0.2 },
      { time: 1, auto: false, endpoint: { time: 1, side: "start" } },
    );
    expect(maskAt(start, 0.5).width).toBe(0.2);
    expect(maskAt(start, 2).width).toBe(1);
    const end = animateMask(
      start,
      { x: 0.4 },
      { time: 2, auto: false, endpoint: { time: 2, side: "end" } },
    );
    expect(maskAt(end, 1).x).toBe(0.05);
    expect(maskAt(end, 2).x).toBe(0.4);
    for (const time of [0, 1, 1.5, 2, 3])
      expect(transformAt(end, time)).toMatchObject(clip.transform);
    expect(
      validateProject({ ...createProject(), clips: [end] }).clips[0],
    ).toEqual(end);
    expect(hasMaskAnimation(clearMaskChannels(end))).toBe(false);
    expect(animateMask(clip, { width: NaN }, { time: 1, auto: true })).toBe(
      clip,
    );
    expect(
      maskAt(animateMask(clip, { width: 0 }, { time: 0, auto: false }), 0)
        .width,
    ).toBe(0.01);
  });

  it("动画箭头的拉伸、复制、删除、缓动、剪切与变速保留遮罩通道", () => {
    let clip = source();
    clip = addAnimationKeyframe(clip, 2, 10)!.clip;
    clip = animateMask(
      clip,
      { width: 1, x: 0.5, rotation: 30, opacity: 0.3 },
      { time: 2, auto: false, endpoint: { time: 2, side: "end" } },
    );
    const range = animationRanges(clip)[0];
    const longer = retimeAnimation(clip, range, "end", 0.5, 10);
    expect(maskAt(longer, 1).width).toBe(0.1);
    expect(maskAt(longer, 2.5).width).toBe(1);
    const copied = snapshotAnimation(clip, range)!;
    const pasted = pasteAnimation({ ...source(), duration: 5 }, copied, 3);
    expect(maskAt(pasted, 4).width).toBe(1);
    expect(maskAt(pasted, 3.5).opacity).toBeCloseTo(0.15);
    const removed = removeAnimation(clip, range);
    expect(maskAt(removed, 2).width).toBe(0.1);
    const eased = setAnimationEasing(clip, range, "exponential");
    expect(maskAt(eased, 1.25).width).toBeLessThan(maskAt(clip, 1.25).width);
    const project = { ...createProject(), clips: [clip] };
    const right = splitClip(project, clip.id, 1.5).clips[1];
    expect(maskAt(right, 0.25).width).toBeCloseTo(maskAt(clip, 1.75).width);
    const faster = changeSpeed(right, 2);
    expect(maskAt(faster, 0.125).width).toBeCloseTo(maskAt(clip, 1.75).width);
  });

  it("真实视频逐步显示固定素材，截帧、保存重开和剪切后的进度一致", async () => {
    const root = path.resolve(`test-output/mask-animation-${Date.now()}`);
    await fs.mkdir(root, { recursive: true });
    const input = path.join(root, "green.mp4");
    await runProcess(findBinary("ffmpeg"), [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=lime:s=160x100:r=10:d=3",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      input,
    ]);
    const asset = await probeMedia(input);
    const project = createProject("遮罩滑动显示");
    project.canvas = {
      width: 160,
      height: 100,
      fps: 10,
      background: "#5432b2",
    };
    project.assets = [asset];
    project.exportSettings = { encoder: "software" };
    const clip = animateMask(
      { ...source(), kind: "video", assetId: asset.id },
      { x: 0.5, width: 1 },
      { time: 2, auto: true },
    );
    project.clips = [clip];
    const file = path.join(root, "project.troncut");
    await saveProject(project, file);
    const reopened = await openProject(file);
    expect(reopened.clips[0].keyframes).toEqual(clip.keyframes);
    const output = path.join(root, "wipe.mp4");
    await exportVideo(
      reopened,
      output,
      path.join(root, "render"),
      false,
      AbortSignal.timeout(20000),
      () => {},
    );
    const pixels = async (file: string) => {
      const { data, info } = await sharp(file)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return (x: number) => [
        ...data.subarray(
          (50 * info.width + x) * 3,
          (50 * info.width + x) * 3 + 3,
        ),
      ];
    };
    for (const [time, visible, hidden] of [
      [0.5, 10, 40],
      [1.5, 70, 110],
      [2.5, 150, -1],
    ]) {
      const frame = path.join(root, `frame-${time}.png`);
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
      const pixel = await pixels(frame);
      expect(pixel(visible)[1]).toBeGreaterThan(235);
      if (hidden >= 0)
        [84, 50, 178].forEach((channel, i) =>
          expect(Math.abs(pixel(hidden)[i] - channel)).toBeLessThan(15),
        );
    }
    for (const [name, fixture] of [
      ["still", reopened],
      ["split", splitClip(reopened, clip.id, 1.25)],
    ] as const) {
      const frame = path.join(root, `${name}.png`);
      await exportFrame(
        fixture,
        1.5,
        frame,
        path.join(root, name),
        AbortSignal.timeout(20000),
      );
      const pixel = await pixels(frame);
      expect(pixel(70)[1]).toBeGreaterThan(235);
      expect(pixel(110)[2]).toBeGreaterThan(160);
    }
    const files = await fs.readdir(path.join(root, "render", "mask-0"));
    expect(files.filter((file) => file.endsWith(".png")).length).toBeLessThan(
      20,
    );
  }, 30000);
});
