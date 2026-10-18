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
import {
  addVisualEffect,
  additionalVisualEffectPresets,
  defaultVisualEffect,
  effectAmount,
} from "../shared/visual-effects";
import {
  visualEffectDragType,
  visualEffectFromDragTypes,
  supportsVisualEffect,
} from "../shared/visual-effect-drag";
import { exportFrame, exportVideo } from "../electron/export";
import { probeMedia } from "../electron/media";
import { openProject, saveProject } from "../electron/project-store";
import { splitClip, changeSpeed } from "../shared/editor";

describe("新增视觉效果", () => {
  it("可持久化、拒绝音频与非法参数，拖动期间可识别预设", () => {
    const project = createProject("效果");
    let clip = newText(project.tracks[0].id, 0);
    expect(defaultVisualEffect("mask")).toMatchObject({ width: 1, height: 1 });
    expect(defaultVisualEffect("blur-region")).toMatchObject({
      width: 0.5,
      height: 0.5,
    });
    for (const { id } of additionalVisualEffectPresets) {
      clip = addVisualEffect(clip, id);
      expect(addVisualEffect(clip, id)).toBe(clip);
      expect(supportsVisualEffect({ ...clip, kind: "audio" }, id)).toBe(false);
      expect(
        visualEffectFromDragTypes(["troncut-effect", visualEffectDragType(id)]),
      ).toBe(id);
    }
    project.clips = [clip];
    expect(validateProject(project).clips[0].visualEffects).toEqual(
      clip.visualEffects,
    );
    expect(() =>
      validateProject({
        ...project,
        clips: [
          {
            ...clip,
            visualEffects: {
              shadow: { ...defaultVisualEffect("shadow"), blur: Infinity },
            },
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      validateProject({
        ...project,
        clips: [
          {
            ...clip,
            visualEffects: {
              mask: { ...defaultVisualEffect("mask"), width: 0 },
            },
          },
        ],
      }),
    ).toThrow();
    const timed = { ...defaultVisualEffect("tint"), easeIn: 2, easeOut: 2 };
    expect(effectAmount(timed, 0, 1)).toBe(0);
    expect(effectAmount(timed, 0.5, 1)).toBe(1);
    expect(effectAmount(timed, 1, 1)).toBe(0);
  });
  it("剪切与变速保留效果的缓入缓出时间", () => {
    const project = createProject("剪切效果");
    const clip = {
      ...newText(project.tracks[0].id, 0),
      duration: 2,
      visualEffects: {
        tint: { ...defaultVisualEffect("tint"), easeIn: 1, easeOut: 0.5 },
      },
    };
    project.clips = [clip];
    const [left, right] = splitClip(project, clip.id, 0.5).clips;
    expect(effectAmount(left.visualEffects!.tint!, 0.25, left.duration)).toBe(
      0.25,
    );
    expect(effectAmount(right.visualEffects!.tint!, 0.25, right.duration)).toBe(
      0.75,
    );
    const faster = changeSpeed(right, 2);
    expect(
      effectAmount(faster.visualEffects!.tint!, 0.125, faster.duration),
    ).toBe(0.75);
  });

  it("真实导出抠色、着色、遮罩、阴影、区域模糊、边框与四种媒体遮罩，保存重开及缓入一致", async () => {
    const root = path.resolve(`test-output/visual-effects-${Date.now()}`);
    await fs.mkdir(root, { recursive: true });
    const source = path.join(root, "source.png");
    await sharp(
      Buffer.from(
        '<svg width="160" height="100"><rect width="80" height="100" fill="#00ff00"/><rect x="80" width="80" height="100" fill="#ff0000"/></svg>',
      ),
    )
      .png()
      .toFile(source);
    const asset = await probeMedia(source);
    const project = createProject("效果渲染");
    project.canvas = {
      width: 160,
      height: 100,
      fps: 10,
      background: "#102060",
    };
    project.tracks = [newTrack(0), newTrack(1)];
    project.assets = [asset];
    const base: Clip = {
      ...newText(project.tracks[1].id, 0),
      id: "source",
      kind: "image",
      assetId: asset.id,
      duration: 1,
    };
    const render = async (name: string, clips: Clip[], time = 0.5) => {
      project.clips = clips;
      const file = path.join(root, `${name}.troncut`);
      await saveProject(project, file);
      const reopened = await openProject(file);
      expect(reopened.clips.map((clip) => clip.visualEffects)).toEqual(
        clips.map((clip) => clip.visualEffects),
      );
      const output = path.join(root, `${name}.png`);
      await exportFrame(
        reopened,
        time,
        output,
        path.join(root, name),
        AbortSignal.timeout(20000),
      );
      const { data, info } = await sharp(output)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return (x: number, y: number) => [
        ...data.subarray(
          (y * info.width + x) * 3,
          (y * info.width + x) * 3 + 3,
        ),
      ];
    };
    const near = (actual: number[], expected: number[], tolerance = 8) =>
      actual.forEach((channel, i) =>
        expect(Math.abs(channel - expected[i])).toBeLessThan(tolerance),
      );
    const background = [16, 32, 96];
    let pixel = await render("key", [
      {
        ...base,
        visualEffects: { "remove-color": defaultVisualEffect("remove-color") },
      },
    ]);
    near(pixel(20, 50), background);
    near(pixel(130, 50), [255, 0, 0]);
    pixel = await render("key-invert", [
      {
        ...base,
        visualEffects: {
          "remove-color": {
            ...defaultVisualEffect("remove-color"),
            invert: true,
          },
        },
      },
    ]);
    near(pixel(20, 50), [0, 255, 0]);
    near(pixel(130, 50), background);
    pixel = await render("tint", [
      {
        ...base,
        visualEffects: {
          tint: { ...defaultVisualEffect("tint"), color: "#0000ff" },
        },
      },
    ]);
    near(pixel(20, 50), [0, 0, 182]);
    pixel = await render("tint-ease", [
      {
        ...base,
        duration: 2,
        visualEffects: {
          tint: { ...defaultVisualEffect("tint"), color: "#0000ff", easeIn: 1 },
        },
      },
    ]);
    near(pixel(20, 50), [0, 127, 91]);
    pixel = await render("mask", [
      {
        ...base,
        visualEffects: {
          mask: {
            ...defaultVisualEffect("mask"),
            feather: 0,
            width: 0.5,
            height: 0.5,
          },
        },
      },
    ]);
    near(pixel(20, 20), background);
    near(pixel(65, 50), [0, 255, 0]);
    pixel = await render("border", [
      {
        ...base,
        transform: { ...base.transform, scale: 0.5 },
        visualEffects: {
          border: {
            ...defaultVisualEffect("border"),
            color: "#0000ff",
            width: 8,
          },
        },
      },
    ]);
    near(pixel(37, 50), [0, 0, 255]);
    near(pixel(50, 50), [0, 255, 0]);
    pixel = await render("shadow", [
      {
        ...base,
        transform: { ...base.transform, scale: 0.5 },
        visualEffects: {
          shadow: {
            ...defaultVisualEffect("shadow"),
            angle: 0,
            offset: 20,
            opacity: 1,
            blur: 0,
          },
        },
      },
    ]);
    near(pixel(125, 50), [0, 0, 0]);
    near(pixel(145, 50), background);
    pixel = await render("region", [
      {
        ...base,
        visualEffects: {
          "blur-region": {
            ...defaultVisualEffect("blur-region"),
            opacity: 0,
            blur: 20,
            feather: 0,
          },
        },
      },
    ]);
    expect(pixel(79, 50)[0]).toBeGreaterThan(70);
    expect(pixel(79, 50)[1]).toBeGreaterThan(70);
    near(pixel(20, 50), [0, 255, 0]);
    const transparentSource = path.join(root, "transparent.png");
    await sharp(
      Buffer.from(
        '<svg width="160" height="100"><rect width="80" height="100" fill="#00ff00"/></svg>',
      ),
    )
      .png()
      .toFile(transparentSource);
    const transparentAsset = await probeMedia(transparentSource);
    project.assets.push(transparentAsset);
    pixel = await render("transparent-region", [
      {
        ...base,
        assetId: transparentAsset.id,
        visualEffects: {
          "blur-region": {
            ...defaultVisualEffect("blur-region"),
            x: 0.25,
            width: 0.2,
            height: 1,
            feather: 0,
            opacity: 0,
            blur: 40,
          },
        },
      },
    ]);
    near(pixel(85, 50), background);
    near(pixel(140, 50), background);
    for (const mode of [
      "alpha",
      "alpha-invert",
      "luma",
      "luma-invert",
    ] as const) {
      const matte: Clip = {
        ...newText(project.tracks[0].id, 0),
        id: "matte",
        kind: "shape",
        shape: "ellipse",
        fill: mode.startsWith("luma") ? "#808080" : "#ffffff",
        duration: 1,
        transform: {
          ...base.transform,
          scale: 0.16,
          opacity: mode.startsWith("luma") ? 0.5 : 1,
        },
        visualEffects: {
          "media-matte": { ...defaultVisualEffect("media-matte"), mode },
        },
      };
      pixel = await render(`matte-${mode}`, [matte, base]);
      if (mode === "alpha") {
        near(pixel(5, 5), background);
        near(pixel(65, 50), [0, 255, 0]);
      }
      if (mode === "alpha-invert") {
        near(pixel(5, 5), [0, 255, 0]);
        near(pixel(65, 50), background);
      }
      if (mode === "luma") near(pixel(65, 50), [12, 88, 72]);
      if (mode === "luma-invert") near(pixel(65, 50), [4, 199, 24]);
    }
    project.clips = [
      {
        ...base,
        visualEffects: {
          tint: { ...defaultVisualEffect("tint"), easeIn: 0.5 },
          mask: { ...defaultVisualEffect("mask"), feather: 0 },
          shadow: defaultVisualEffect("shadow"),
          border: defaultVisualEffect("border"),
          "blur-region": { ...defaultVisualEffect("blur-region"), feather: 0 },
        },
      },
    ];
    project.exportSettings = { encoder: "software" };
    await exportVideo(
      project,
      path.join(root, "effects.mp4"),
      path.join(root, "video"),
      false,
      AbortSignal.timeout(20000),
      () => { },
    );
    expect(
      (await probeMedia(path.join(root, "effects.mp4"))).duration,
    ).toBeGreaterThan(0.8);
  }, 60000);
});
