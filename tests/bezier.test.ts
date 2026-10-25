import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { annotationClip, parseAnnotation } from "../shared/annotations";
import { annotationSvgBody } from "../shared/annotation-style";
import { createProject, validateProject } from "../shared/model";
import {
  adjustPenHandle,
  fitPolygonAnnotation,
  insertPenAnchor,
  movePenAnchor,
  polygonAnnotation,
  polygonToCanvas,
} from "../shared/polygon";
import {
  cubicPoint,
  penSegments,
  splitCubic,
  type BezierAnchor,
  type CubicCurve,
} from "../shared/bezier";
import { rasterizeAnnotation } from "../electron/annotation-export";
import { exportFrame } from "../electron/export";

const canvas = { width: 640, height: 360 };
const curved: BezierAnchor[] = [
  { x: 40, y: 160, out: { x: 40, y: 40 } },
  { x: 240, y: 160, in: { x: 240, y: 40 }, handleMode: "independent" },
  { x: 140, y: 160 },
];

function fixture(points: BezierAnchor[] = curved) {
  const result = polygonAnnotation(points, canvas)!;
  expect(result).not.toBeNull();
  if (result.template.kind !== "shape") throw new Error("Expected a shape");
  const clip = annotationClip(result.template, "titles", 0);
  clip.transform = { ...clip.transform, ...result.position };
  return { ...result, template: result.template, clip };
}

describe("Photoshop 风格贝塞尔钢笔", () => {
  it("混合输出 L/C/Z，保存手柄并在部分进度保留 C", () => {
    const { template, clip } = fixture();
    expect(parseAnnotation(JSON.stringify(template))).toEqual(template);
    const project = { ...createProject(), clips: [clip] };
    const restored = validateProject(JSON.parse(JSON.stringify(project)))
      .clips[0];
    expect(restored.linePoints?.[0].out).toEqual(clip.linePoints?.[0].out);
    expect(restored.linePoints?.[1].handleMode).toBe("independent");
    const svg = annotationSvgBody(restored);
    expect(svg.match(/ C/g)).toHaveLength(1);
    expect(svg.match(/ L/g)).toHaveLength(2);
    expect(svg).toContain(" Z");
    expect(annotationSvgBody(restored, 0)).toBe("");
    const partial = annotationSvgBody(restored, 0.35);
    expect(partial).toContain(" C");
    expect(partial).not.toContain(" Z");
    expect(partial).toContain('fill="none"');
    const straight = fixture([
      { x: 40, y: 40 },
      { x: 240, y: 40 },
      { x: 140, y: 180 },
    ]);
    expect(annotationSvgBody(straight.clip)).not.toContain(" C");
  });

  it("闭合段也使用贝塞尔手柄", () => {
    const { clip } = fixture([
      { x: 40, y: 40, in: { x: 20, y: 120 } },
      { x: 240, y: 40 },
      { x: 140, y: 180, out: { x: 100, y: 220 } },
    ]);
    const segments = penSegments(
      clip.linePoints!.map((anchor) => ({
        ...anchor,
        x: anchor.x * clip.shapeSize!.width,
        y: anchor.y * clip.shapeSize!.height,
        in: anchor.in && {
          x: anchor.in.x * clip.shapeSize!.width,
          y: anchor.in.y * clip.shapeSize!.height,
        },
        out: anchor.out && {
          x: anchor.out.x * clip.shapeSize!.width,
          y: anchor.out.y * clip.shapeSize!.height,
        },
      })),
      true,
    );
    expect(segments.at(-1)?.kind).toBe("cubic");
    expect(annotationSvgBody(clip).match(/ C/g)).toHaveLength(1);
  });

  it("共线锚点可以围成曲线，超出手柄也完整归一化", () => {
    const result = polygonAnnotation(
      [
        { x: 100, y: 160, out: { x: 100, y: -80 } },
        { x: 240, y: 160, in: { x: 240, y: -80 } },
        { x: 140, y: 160 },
      ],
      canvas,
    )!;
    expect(result).not.toBeNull();
    if (result.template.kind !== "shape") return;
    expect(result.template.size!.height).toBeGreaterThan(240);
    for (const anchor of result.template.linePoints!)
      for (const point of [anchor, anchor.in, anchor.out])
        if (point) {
          expect(point.x).toBeGreaterThanOrEqual(0);
          expect(point.x).toBeLessThanOrEqual(1);
          expect(point.y).toBeGreaterThanOrEqual(0);
          expect(point.y).toBeLessThanOrEqual(1);
        }
  });

  it("曲线分割和线段插入保持原几何", () => {
    const curve: CubicCurve = {
      start: { x: 0, y: 0 },
      c1: { x: 20, y: -40 },
      c2: { x: 80, y: 100 },
      end: { x: 100, y: 20 },
    };
    const split = splitCubic(curve, 0.37);
    expect(split.point).toEqual(cubicPoint(curve, 0.37));
    expect(cubicPoint(split.left, 1)).toEqual(split.point);
    expect(cubicPoint(split.right, 0)).toEqual(split.point);
    const anchors: BezierAnchor[] = [
      { x: 0, y: 0, out: curve.c1 },
      { x: 100, y: 20, in: curve.c2 },
    ];
    const inserted = insertPenAnchor(anchors, 0, 0.5, false);
    expect(inserted).toHaveLength(3);
    const segments = penSegments(inserted, false);
    expect(segments[0].kind).toBe("cubic");
    expect(segments[1].kind).toBe("cubic");
    if (segments[0].kind === "cubic")
      expect(cubicPoint(segments[0], 1)).toEqual(cubicPoint(curve, 0.5));
  });

  it("整体移动锚点并支持对齐和独立手柄", () => {
    const anchors: BezierAnchor[] = [
      {
        x: 100,
        y: 100,
        in: { x: 80, y: 100 },
        out: { x: 120, y: 100 },
        handleMode: "aligned",
      },
    ];
    const moved = movePenAnchor(anchors, 0, { x: 130, y: 120 })[0];
    expect(moved.in).toEqual({ x: 110, y: 120 });
    expect(moved.out).toEqual({ x: 150, y: 120 });
    const aligned = adjustPenHandle(anchors, 0, "out", { x: 140, y: 120 })[0];
    expect(aligned.handleMode).toBe("aligned");
    expect(aligned.in!.x).toBeCloseTo(82.111, 2);
    expect(aligned.in!.y).toBeCloseTo(91.056, 2);
    const independent = adjustPenHandle(
      anchors,
      0,
      "out",
      { x: 150, y: 140 },
      true,
    )[0];
    expect(independent.handleMode).toBe("independent");
    expect(independent.in).toEqual(anchors[0].in);
    expect(independent.out).toEqual({ x: 150, y: 140 });
  });

  it("已有曲线在画布坐标和对象坐标间往返且不跳动", () => {
    const { clip } = fixture();
    clip.transform = {
      ...clip.transform,
      scale: 1.2,
      scaleX: 1.1,
      rotation: 20,
    };
    clip.keyframes = [{ time: 0, value: { ...clip.transform } }];
    const canvasAnchors = polygonToCanvas(clip, canvas, 0);
    const restored = fitPolygonAnnotation(clip, canvasAnchors, canvas, 0)!;
    expect(restored.shapeSize!.width).toBeCloseTo(clip.shapeSize!.width, 6);
    expect(restored.shapeSize!.height).toBeCloseTo(clip.shapeSize!.height, 6);
    expect(restored.transform.x).toBeCloseTo(clip.transform.x, 6);
    expect(restored.transform.y).toBeCloseTo(clip.transform.y, 6);
    restored.linePoints!.forEach((anchor, index) => {
      expect(anchor.x).toBeCloseTo(clip.linePoints![index].x, 6);
      expect(anchor.y).toBeCloseTo(clip.linePoints![index].y, 6);
    });
    const changed = canvasAnchors.map((anchor) => ({ ...anchor }));
    changed[1].x += 30;
    const edited = fitPolygonAnnotation(clip, changed, canvas, 0)!;
    expect(edited.linePoints).not.toEqual(restored.linePoints);
    expect(edited.keyframes[0].value.x).toBeCloseTo(
      clip.keyframes[0].value.x + edited.transform.x - clip.transform.x,
      6,
    );
  });

  it("真实曲线 PNG 和截帧保留弧度且不裁切", async () => {
    const root = path.resolve(`test-output/bezier-${Date.now()}`);
    await fs.mkdir(root, { recursive: true });
    const { clip } = fixture();
    const image = path.join(root, "curve.png");
    await rasterizeAnnotation(clip, image);
    const { data, info } = await sharp(image)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const alpha = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
    expect(alpha(109, 59)).toBeGreaterThan(240);
    expect(alpha(109, 20)).toBe(0);
    let edgeInk = 0;
    for (let y = 0; y < info.height; y++)
      for (let x = 0; x < info.width; x++)
        if (
          (x === 0 ||
            y === 0 ||
            x === info.width - 1 ||
            y === info.height - 1) &&
          alpha(x, y)
        )
          edgeInk++;
    expect(edgeInk).toBe(0);
    const project = createProject("曲线导出");
    project.canvas = { ...canvas, fps: 10, background: "#101010" };
    project.clips = [clip];
    project.exportSettings = { encoder: "software" };
    const frame = path.join(root, "frame.png");
    await exportFrame(
      project,
      0,
      frame,
      path.join(root, "work"),
      new AbortController().signal,
    );
    const pixels = await sharp(frame).removeAlpha().raw().toBuffer();
    const sample = (x: number, y: number) =>
      Array.from(
        pixels.subarray(
          (y * canvas.width + x) * 3,
          (y * canvas.width + x) * 3 + 3,
        ),
      );
    expect(sample(140, 90)[1]).toBeGreaterThan(140);
    expect(sample(140, 90)[2]).toBeGreaterThan(180);
    expect(sample(140, 40)).toEqual([16, 16, 16]);
  });
});
