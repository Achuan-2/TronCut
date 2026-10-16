import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  annotationClip,
  parseAnnotation,
  arrowPresets,
  shapePresets,
  sketchPresets,
  annotationEffectPresets,
} from "../shared/annotations";
import {
  annotationSvgBody,
  drawingProgress,
  shapeStyleSchema,
} from "../shared/annotation-style";
import {
  createProject,
  defaultTransform,
  validateProject,
  type Clip,
} from "../shared/model";
import { changeSpeed, splitClip } from "../shared/editor";
import { frameSnapshot } from "../shared/frame-snapshot";
import { rasterizeAnnotation } from "../electron/annotation-export";
import { exportFrame, exportVideo } from "../electron/export";
import { runProcess, findBinary } from "../electron/process";

describe("可编辑标注", () => {
  it("全部箭头、形状、区域效果和草图模板可解析并持久化", () => {
    expect(arrowPresets).toHaveLength(8);
    expect(shapePresets).toHaveLength(8);
    expect(sketchPresets).toHaveLength(10);
    expect(annotationEffectPresets).toHaveLength(4);
    for (const preset of [
      ...arrowPresets,
      ...shapePresets,
      ...sketchPresets,
      ...annotationEffectPresets,
    ]) {
      expect(parseAnnotation(JSON.stringify(preset.template))).toEqual(
        preset.template,
      );
      const project = createProject();
      project.clips = [annotationClip(preset.template, "titles", 0)];
      expect(
        validateProject(JSON.parse(JSON.stringify(project))).clips[0].shape,
      ).toBe(project.clips[0].shape);
      expect(annotationSvgBody(project.clips[0])).toMatch(
        /<(path|rect|ellipse)/,
      );
    }
    expect(parseAnnotation('{"kind":"shape","shape":"invalid"}')).toBeNull();
  });

  it("涂鸦保留坐标，动画进度在截帧、拆分和变速后保持一致", () => {
    const clip = annotationClip(
      {
        kind: "shape",
        shape: "freehand",
        size: { width: 120, height: 80 },
        style: shapeStyleSchema.parse({
          fillEnabled: false,
          stroke: "#ff0000",
          strokeWidth: 8,
        }),
        drawing: {
          enabled: true,
          duration: 2,
          delay: 0.5,
          points: [
            { x: 10, y: 40 },
            { x: 110, y: 40 },
          ],
        },
      },
      "titles",
      0,
    );
    expect(drawingProgress(clip, 0.5)).toBe(0);
    expect(drawingProgress(clip, 1.5)).toBe(0.5);
    expect(annotationSvgBody(clip, 0)).toBe("");
    expect(annotationSvgBody(clip, 0.5)).toContain("60.000,40.000");
    const project = { ...createProject(), clips: [clip] };
    expect(drawingProgress(frameSnapshot(project, 1.5).clips[0], 0)).toBe(0.5);
    const right = splitClip(project, clip.id, 1).clips[1];
    expect(drawingProgress(right, 0.5)).toBe(0.5);
    expect(drawingProgress(changeSpeed(right, 2), 0.25)).toBe(0.5);
    expect(
      validateProject(JSON.parse(JSON.stringify(project))).clips[0].drawing
        ?.points,
    ).toEqual(clip.drawing?.points);
  });

  it("矢量绘制进度导出为逐步增加的笔迹，而不是缩放整张图片", async () => {
    const root = path.resolve(`test-output/annotation-stroke-${Date.now()}`);
    await fs.mkdir(root, { recursive: true });
    const clip = annotationClip(
      sketchPresets.find((preset) => preset.id === "line")!.template,
      "titles",
      0,
    );
    clip.duration = 2;
    clip.shapeSize = { width: 120, height: 60 };
    const counts: number[] = [];
    for (const [i, time] of [0, 0.25, 0.75, 1.5].entries()) {
      const file = path.join(root, `${i}.png`);
      await rasterizeAnnotation(clip, file, time);
      const { data, info } = await sharp(file)
        .raw()
        .toBuffer({ resolveWithObject: true });
      let count = 0;
      for (let p = 3; p < data.length; p += info.channels)
        if (data[p] > 100) count++;
      counts.push(count);
    }
    expect(counts[0]).toBe(0);
    expect(counts[1]).toBeGreaterThan(0);
    expect(counts[2]).toBeGreaterThan(counts[1] * 2);
    expect(counts[3]).toBeGreaterThan(counts[2]);
    const project = createProject();
    project.canvas = { width: 160, height: 90, fps: 10, background: "#000000" };
    project.clips = [clip];
    project.exportSettings = { encoder: "software" };
    const video = path.join(root, "drawing.mp4");
    await exportVideo(
      project,
      video,
      path.join(root, "work"),
      false,
      new AbortController().signal,
      () => {},
    );
    const frames: number[] = [];
    for (const time of [0.2, 1.5]) {
      const file = path.join(root, `frame-${time}.png`);
      await runProcess(findBinary("ffmpeg"), [
        "-y",
        "-ss",
        String(time),
        "-i",
        video,
        "-frames:v",
        "1",
        file,
      ]);
      const { data, info } = await sharp(file)
        .raw()
        .toBuffer({ resolveWithObject: true });
      let count = 0;
      for (let p = 0; p < data.length; p += info.channels)
        if (data[p] > 100 && data[p + 1] < 80) count++;
      frames.push(count);
    }
    expect(frames[1]).toBeGreaterThan(frames[0] * 2);
  });

  it("四种区域效果只处理下方合成画面，范围外与非生效时段保持原图", async () => {
    const root = path.resolve(`test-output/annotation-regions-${Date.now()}`);
    await fs.mkdir(root, { recursive: true });
    const image = path.join(root, "checker.png");
    const raw = Buffer.alloc(320 * 180 * 3);
    for (let y = 0; y < 180; y++)
      for (let x = 0; x < 320; x++) {
        const value = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? 0 : 255;
        raw.fill(value, (y * 320 + x) * 3, (y * 320 + x) * 3 + 3);
      }
    await sharp(raw, { raw: { width: 320, height: 180, channels: 3 } })
      .png()
      .toFile(image);
    const project = createProject();
    project.canvas = {
      width: 320,
      height: 180,
      fps: 10,
      background: "#000000",
    };
    project.assets = [
      {
        id: "checker",
        name: "checker.png",
        path: image,
        kind: "image",
        width: 320,
        height: 180,
        duration: 0,
        hasAudio: false,
      },
    ];
    const source: Clip = {
      ...annotationClip(shapePresets[0].template, "video", 0),
      kind: "image",
      assetId: "checker",
      duration: 3,
      transform: { ...defaultTransform },
    };
    const sample = (data: Buffer, x: number, y: number) =>
      Array.from(data.subarray((y * 320 + x) * 3, (y * 320 + x) * 3 + 3));
    for (const preset of annotationEffectPresets) {
      const effect = annotationClip(preset.template, "titles", 1);
      effect.duration = 1.5;
      effect.shapeSize = { width: 120, height: 80 };
      project.clips = [source, effect];
      const file = path.join(root, `${preset.id}.png`);
      await exportFrame(
        project,
        1.5,
        file,
        path.join(root, `work-${preset.id}`),
        new AbortController().signal,
      );
      const data = await sharp(file).removeAlpha().raw().toBuffer();
      const original = sample(raw, 160, 90),
        centre = sample(data, 160, 90);
      if (preset.id === "spotlight") {
        expect(centre).toEqual(original);
        expect(sample(data, 32, 32)[0]).toBeLessThan(150);
        const inactive = path.join(root, "inactive.png");
        await exportFrame(
          project,
          0.5,
          inactive,
          path.join(root, "work-inactive"),
          new AbortController().signal,
        );
        expect(
          sample(
            await sharp(inactive).removeAlpha().raw().toBuffer(),
            32,
            32,
          )[0],
        ).toBeGreaterThan(240);
        effect.fadeIn = 1;
        const fading = path.join(root, "spotlight-fading.png");
        await exportFrame(
          project,
          1.5,
          fading,
          path.join(root, "work-fading"),
          new AbortController().signal,
        );
        const fadingData = await sharp(fading).removeAlpha().raw().toBuffer();
        expect(sample(fadingData, 160, 90)).toEqual(original);
        expect(sample(fadingData, 32, 32)[0]).toBeGreaterThan(150);
        expect(sample(fadingData, 32, 32)[0]).toBeLessThan(200);
      } else {
        expect(sample(data, 32, 32)[0]).toBeGreaterThan(240);
        if (preset.id === "blur") expect(centre[0]).toBeGreaterThan(60);
        if (preset.id === "highlight") {
          expect(centre[0]).toBeGreaterThan(100);
          expect(centre[2]).toBeLessThan(30);
        }
        if (preset.id === "pixelate")
          expect(sample(data, 150, 85)).toEqual(sample(data, 151, 85));
      }
    }
  }, 30000);
});
