import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  createProject,
  newText,
  newTrack,
  validateProject,
  type Clip,
} from "../shared/model";
import { addMediaFrame, mediaFrameRadii } from "../shared/media-frame";
import {
  addVisualEffect,
  additionalVisualEffectPresets,
  defaultVisualEffect,
  effectAmount,
} from "../shared/visual-effects";
import {
  dragVisualEffectWindow,
  setVisualEffectWindow,
  visualEffectEntries,
} from "../shared/visual-effect-range";
import { effectActive, effectWindow } from "../shared/effect-timing";
import { changeSpeed, splitClip } from "../shared/editor";
import { frameSnapshot } from "../shared/frame-snapshot";
import { animateMask } from "../shared/mask-animation";
import { exportFrame, exportVideo } from "../electron/export";
import { probeMedia } from "../electron/media";
import { findBinary, runProcess } from "../electron/process";
import { openProject, saveProject } from "../electron/project-store";

function source(): Clip {
  return {
    ...newText("video", 0),
    kind: "image",
    assetId: "image",
    duration: 4,
  };
}

describe("视觉效果时间条", () => {
  it("八种效果独立裁剪、移动和逐帧对齐，不改变片段与遮罩动画", () => {
    let clip = addMediaFrame(source());
    for (const { id } of additionalVisualEffectPresets)
      clip = addVisualEffect(clip, id);
    clip = animateMask(clip, { width: 1 }, { time: 2, auto: true });
    const original = clip;
    expect(visualEffectEntries(clip)).toHaveLength(8);
    for (const { id } of visualEffectEntries(clip)) {
      clip = dragVisualEffectWindow(clip, id, "start", 1.04, 10);
      clip = dragVisualEffectWindow(clip, id, "end", -1.02, 10);
      const effect = visualEffectEntries(clip).find(
        (entry) => entry.id === id,
      )!.effect;
      expect(effectWindow(effect, clip.duration)).toEqual({ start: 1, end: 3 });
      const moved = dragVisualEffectWindow(clip, id, "move", -0.5, 10);
      expect(
        effectWindow(
          visualEffectEntries(moved).find((entry) => entry.id === id)!.effect,
          4,
        ),
      ).toEqual({ start: 0.5, end: 2.5 });
      const minimum = dragVisualEffectWindow(clip, id, "start", 100, 10);
      expect(
        effectWindow(
          visualEffectEntries(minimum).find((entry) => entry.id === id)!.effect,
          4,
        ).start,
      ).toBeCloseTo(2.9);
    }
    expect(clip).toMatchObject({
      start: original.start,
      duration: original.duration,
      speed: original.speed,
      sourceIn: original.sourceIn,
      transform: original.transform,
      keyframes: original.keyframes,
    });
    expect(clip.visualEffects!.tint!.range).toBe("all");
    expect(setVisualEffectWindow(clip, "mask", { start: 1, end: 3 })).toBe(
      clip,
    );
    expect(setVisualEffectWindow(clip, "mask", { start: NaN, end: 2 })).toBe(
      clip,
    );
    expect(setVisualEffectWindow(clip, "mask", { start: 2, end: 1 })).toBe(
      clip,
    );
    const project = createProject();
    project.assets = [
      {
        id: "image",
        name: "图片",
        path: "image.png",
        kind: "image",
        width: 160,
        height: 100,
        duration: 0,
        hasAudio: false,
      },
    ];
    expect(validateProject({ ...project, clips: [clip] }).clips[0]).toEqual(
      clip,
    );
  });

  it("缓入缓出从效果条起止计算；剪切、变速及截帧保留时间范围", () => {
    const effect = {
      ...defaultVisualEffect("mask"),
      window: { start: 1, end: 3 },
      easeIn: 0.5,
      easeOut: 0.5,
    };
    const clip = {
      ...addMediaFrame(source()),
      visualEffects: { mask: effect },
    };
    clip.mediaFrame = { ...clip.mediaFrame!, window: { start: 1, end: 3 } };
    expect(
      [0.5, 1, 1.25, 2, 2.75, 3, 3.5].map((time) =>
        effectAmount(effect, time, 4),
      ),
    ).toEqual([0, 0, 0.5, 1, 0.5, 0, 0]);
    expect(mediaFrameRadii(clip, { width: 160, height: 100 }, 0.5)).toEqual([
      0, 0, 0, 0,
    ]);
    expect(mediaFrameRadii(clip, { width: 160, height: 100 }, 1.5)).toEqual([
      10, 10, 10, 10,
    ]);
    const project = { ...createProject(), clips: [clip] };
    const [left, right] = splitClip(project, clip.id, 2).clips;
    expect(effectWindow(left.visualEffects!.mask!, 2)).toEqual({
      start: 1,
      end: 2,
    });
    expect(effectWindow(right.visualEffects!.mask!, 2)).toEqual({
      start: 0,
      end: 1,
    });
    expect(effectWindow(right.mediaFrame!, 2)).toEqual({ start: 0, end: 1 });
    expect(effectAmount(right.visualEffects!.mask!, 0.75, 2)).toBe(0.5);
    const faster = changeSpeed(right, 2);
    expect(effectWindow(faster.mediaFrame!, 1)).toEqual({ start: 0, end: 0.5 });
    expect(effectAmount(faster.visualEffects!.mask!, 0.375, 1)).toBe(0.5);
    const trimmed = setVisualEffectWindow(right, "mask", {
      start: 0.25,
      end: 0.75,
    });
    expect(trimmed.visualEffects!.mask!.window).toEqual({
      start: 2.25,
      end: 2.75,
    });
    const empty = splitClip(project, clip.id, 0.5).clips[0];
    expect(effectActive(empty.visualEffects!.mask!, 0.25, 0.5)).toBe(false);
    const recovered = dragVisualEffectWindow(empty, "mask", "start", -0.2, 10);
    expect(effectWindow(recovered.visualEffects!.mask!, 0.5)).toEqual({
      start: 0.3,
      end: 0.5,
    });
    expect(dragVisualEffectWindow(empty, "mask", "move", -1, 10)).toBe(empty);
    const still = frameSnapshot(project, 0.5).clips[0];
    expect(still.visualEffects!.mask!.enabled).toBe(false);
    expect(still.mediaFrame!.enabled).toBe(false);
    expect(still.visualEffects!.mask!.window).toBeUndefined();
    const matte = {
      ...clip,
      visualEffects: {
        "media-matte": {
          ...defaultVisualEffect("media-matte"),
          window: { start: 1, end: 3 },
        },
      },
    };
    expect(
      frameSnapshot({ ...project, clips: [matte] }, 0.5).clips[0]
        .visualEffects!["media-matte"]!.enabled,
    ).toBe(false);
    expect(() =>
      validateProject({
        ...project,
        clips: [
          {
            ...clip,
            visualEffects: {
              mask: { ...effect, window: { start: 3, end: 2 } },
            },
          },
        ],
      }),
    ).toThrow();
  });

  it("真实视频与截帧只在效果条内应用遮罩、圆角和媒体哑光，保存重开一致", async () => {
    const root = path.resolve(`test-output/visual-effect-range-${Date.now()}`);
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
    const project = createProject("效果生效范围");
    project.canvas = {
      width: 160,
      height: 100,
      fps: 10,
      background: "#5432b2",
    };
    project.tracks = [newTrack(0), newTrack(1)];
    project.assets = [asset];
    project.exportSettings = { encoder: "software" };
    const base: Clip = {
      ...source(),
      kind: "video",
      trackId: project.tracks[1].id,
      assetId: asset.id,
      duration: 3,
      start: 0.4,
    };
    const window = { start: 1, end: 2 };
    const fixtures: [string, Clip[]][] = [
      [
        "mask",
        [
          {
            ...base,
            visualEffects: {
              mask: {
                ...defaultVisualEffect("mask"),
                width: 0.5,
                height: 0.5,
                feather: 0,
                window,
              },
            },
          },
        ],
      ],
      [
        "rounded",
        [
          {
            ...addMediaFrame(base),
            mediaFrame: { radius: 100, unit: "percent", window },
          },
        ],
      ],
      [
        "matte",
        [
          {
            ...newText(project.tracks[1].id, 0),
            kind: "shape",
            shape: "rectangle",
            fill: "#0000ff",
              duration: 3.4,
          },
          {
            ...base,
            trackId: project.tracks[0].id,
            transform: { ...base.transform, scale: 0.5 },
            visualEffects: {
              "media-matte": { ...defaultVisualEffect("media-matte"), window },
            },
          },
        ],
      ],
    ];
    const pixel = async (file: string, x: number, y: number) => {
      const { data, info } = await sharp(file)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const offset = (y * info.width + x) * 3;
      return [...data.subarray(offset, offset + 3)];
    };
    const near = (actual: number[], expected: number[]) =>
      expected.forEach((channel, i) =>
        expect(Math.abs(actual[i] - channel)).toBeLessThan(18),
      );
    for (const [name, clips] of fixtures) {
      project.clips = clips;
      const file = path.join(root, `${name}.troncut`);
      await saveProject(project, file);
      const reopened = await openProject(file);
      expect(reopened.clips.at(-1)!.visualEffects).toEqual(
        clips.at(-1)!.visualEffects,
      );
      expect(reopened.clips.at(-1)!.mediaFrame).toEqual(
        clips.at(-1)!.mediaFrame,
      );
      const output = path.join(root, `${name}.mp4`);
      await exportVideo(
        reopened,
        output,
        path.join(root, `render-${name}`),
        false,
        AbortSignal.timeout(20000),
        () => {},
      );
      for (const local of [0.5, 1.5, 2.5]) {
        const time = base.start + local;
        const videoFrame = path.join(root, `${name}-${time}-video.png`);
        await runProcess(findBinary("ffmpeg"), [
          "-y",
          "-ss",
          String(time),
          "-i",
          output,
          "-frames:v",
          "1",
          videoFrame,
        ]);
        const still = path.join(root, `${name}-${time}-still.png`);
        await exportFrame(
          reopened,
          time,
          still,
          path.join(root, `${name}-${time}`),
          AbortSignal.timeout(20000),
        );
        for (const image of [videoFrame, still]) {
          const inside = local === 1.5;
          near(
            await pixel(image, 5, 5),
            inside
              ? [84, 50, 178]
              : name === "matte"
                ? [0, 0, 255]
                : [0, 255, 0],
          );
          near(
            await pixel(image, 80, 50),
            name === "matte" && inside ? [0, 0, 255] : [0, 255, 0],
          );
        }
      }
    }
  }, 60000);
});
