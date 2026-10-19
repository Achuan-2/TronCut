import { describe, expect, it } from "vitest";
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import {
  annotationClip,
  arrowPresets,
  sketchPresets,
} from "../shared/annotations";
import {
  annotationPaths,
  annotationSvgBody,
  shapeSize,
} from "../shared/annotation-style";
import {
  createProject,
  validateProject,
  type Clip,
  type Transform,
} from "../shared/model";
import { editLine, lineMidpoint, linePointsFor } from "../shared/line-edit";
import { projectDelta } from "../shared/rotation";
import { rotationDragStep } from "../shared/canvas";
import { rasterizeAnnotation } from "../electron/annotation-export";

function worldPoint(clip: Clip, value: Transform, index: number) {
  const points = linePointsFor(clip),
    size = shapeSize(clip);
  const p = index === -1 ? points.at(-1)! : points[index];
  const offset = projectDelta(
    value,
    {
      x: (p.x - size.width / 2) * value.scale * (clip.effects?.flipX ? -1 : 1),
      y: (p.y - size.height / 2) * value.scale * (clip.effects?.flipY ? -1 : 1),
    },
    clip.rotation,
  );
  return { x: value.x * 1000 + offset.x, y: value.y * 600 + offset.y };
}

describe("选框旋转与箭头控制点", () => {
  it("旋转越过正负 180 度连续累积，并允许多圈旋转", () => {
    const rad = (n: number) => (n * Math.PI) / 180;
    expect(rotationDragStep(179, rad(179), rad(-179))).toBeCloseTo(181);
    expect(rotationDragStep(-179, rad(-179), rad(179))).toBeCloseTo(-181);
    expect(rotationDragStep(718, rad(-2), rad(12))).toBeCloseTo(732);
    expect(rotationDragStep(3599, 0, rad(10))).toBe(3600);
  });

  it.each(["start", "end"] as const)(
    "拖动 %s 保持另一端固定，支持缩放、三轴旋转、倾斜与翻转",
    (handle) => {
      for (const flip of [false, true]) {
        const clip = annotationClip(arrowPresets[1].template, "titles", 0);
        clip.effects = { flipX: flip, flipY: flip } as Clip["effects"];
        const value = {
          ...clip.transform,
          scale: 1.3,
          rotation: 35,
          rotationX: 20,
          rotationY: -15,
          scaleX: 1.2,
          scaleY: 0.8,
          skew: 10,
          z: 100,
        };
        const anchorIndex = handle === "start" ? -1 : 0;
        const movingIndex = handle === "start" ? 0 : -1;
        const anchor = worldPoint(clip, value, anchorIndex),
          moving = worldPoint(clip, value, movingIndex);
        const result = editLine(
          clip,
          value,
          handle,
          { x: 60, y: -45 },
          { width: 1000, height: 600 },
        );
        const next = { ...clip, ...result };
        const afterAnchor = worldPoint(next, result.value, anchorIndex),
          afterMoving = worldPoint(next, result.value, movingIndex);
        expect(afterAnchor.x).toBeCloseTo(anchor.x, 7);
        expect(afterAnchor.y).toBeCloseTo(anchor.y, 7);
        expect(afterMoving.x).toBeCloseTo(moving.x + 60, 7);
        expect(afterMoving.y).toBeCloseTo(moving.y - 45, 7);
        expect(result.value.rotation).toBe(value.rotation);
        expect(annotationPaths(next)[0].width).toBe(
          annotationPaths(clip)[0].width,
        );
      }
    },
  );

  it("中点拖动弯曲时两端不变，旧手绘曲线端点拖动保留轮廓", () => {
    for (const template of [
      arrowPresets[1].template,
      sketchPresets.find(
        (p) =>
          p.template.kind === "shape" && p.template.shape === "curved-arrow",
      )!.template,
    ]) {
      const clip = annotationClip(template, "titles", 0);
      const before = linePointsFor(clip),
        mid = lineMidpoint(before);
      const result = editLine(
        clip,
        clip.transform,
        "bend",
        { x: 0, y: 80 },
        { width: 1000, height: 600 },
      );
      const next = { ...clip, ...result };
      for (const index of [0, -1]) {
        const a = worldPoint(clip, clip.transform, index),
          b = worldPoint(next, result.value, index);
        expect(b.x).toBeCloseTo(a.x, 8);
        expect(b.y).toBeCloseTo(a.y, 8);
      }
      const after = lineMidpoint(linePointsFor(next));
      const size = shapeSize(clip),
        nextSize = shapeSize(next);
      const beforeY = clip.transform.y * 600 + mid.y - size.height / 2;
      const afterY = result.value.y * 600 + after.y - nextSize.height / 2;
      expect(afterY - beforeY).toBeCloseTo(80, 0);
    }
  });

  it("端点 Shift 吸附到 15 度，修改后的几何可保存并用于 PNG 导出", async () => {
    const clip = annotationClip(arrowPresets[1].template, "titles", 0);
    const result = editLine(
      clip,
      clip.transform,
      "end",
      { x: -300, y: -130 },
      { width: 1000, height: 600 },
      true,
    );
    const next = { ...clip, ...result, transform: result.value };
    const points = linePointsFor(next),
      a = points[0],
      b = points.at(-1)!;
    expect((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI).toBeCloseTo(-30);
    const project = createProject();
    project.clips = [next];
    const saved = validateProject(JSON.parse(JSON.stringify(project))).clips[0];
    expect(saved.linePoints).toEqual(next.linePoints);
    expect(annotationSvgBody(saved)).toBe(annotationSvgBody(next));
    const directory = path.resolve("test-output/line-edit");
    await fs.mkdir(directory, { recursive: true });
    const image = path.join(directory, "edited-arrow.png");
    await rasterizeAnnotation(saved, image);
    const { data, info } = await sharp(image)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let ink = 0,
      edgeInk = 0;
    for (let y = 0; y < info.height; y++)
      for (let x = 0; x < info.width; x++) {
        if (data[(y * info.width + x) * 4 + 3]) {
          ink++;
          if (
            x === 0 ||
            y === 0 ||
            x === info.width - 1 ||
            y === info.height - 1
          )
            edgeInk++;
        }
      }
    expect(ink).toBeGreaterThan(200);
    expect(edgeInk).toBe(0);
  });
});
