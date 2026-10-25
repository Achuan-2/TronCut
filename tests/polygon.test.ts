import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { annotationClip, parseAnnotation } from "../shared/annotations";
import {
  annotationPaths,
  annotationSvgBody,
  shapeStyleSchema,
  type Point,
} from "../shared/annotation-style";
import { createProject, validateProject } from "../shared/model";
import {
  maxPolygonPoints,
  polygonAnnotation,
  polygonCanvasPoint,
} from "../shared/polygon";
import { rasterizeAnnotation } from "../electron/annotation-export";
import { exportFrame } from "../electron/export";

const canvas = { width: 640, height: 360 };
const vertices: Point[] = [
  { x: 40, y: 40 },
  { x: 240, y: 40 },
  { x: 240, y: 90 },
  { x: 100, y: 90 },
  { x: 100, y: 180 },
  { x: 40, y: 180 },
];

function fixture() {
  const result = polygonAnnotation(vertices, canvas)!;
  if (result.template.kind !== "shape") throw new Error("Expected a shape");
  const clip = annotationClip(result.template, "titles", 0);
  clip.transform = { ...clip.transform, ...result.position };
  return { ...result, template: result.template, clip };
}

describe("钢笔自定义形状", () => {
  it("保留凹多边形顶点、闭合填充和描边，并可保存重开", () => {
    const { template, clip, position } = fixture();
    expect(template.size).toEqual({ width: 218, height: 158 });
    expect(position.x).toBeCloseTo(140 / 640);
    expect(position.y).toBeCloseTo(110 / 360);
    expect(template.linePoints).toHaveLength(6);
    expect(parseAnnotation(JSON.stringify(template))).toEqual(template);
    const path = annotationPaths(clip)[0];
    expect(path.closed).toBe(true);
    expect(path.points[0]).toEqual({ x: 9, y: 9 });
    expect(path.points.at(-1)).toEqual({ x: 9, y: 149 });
    const svg = annotationSvgBody(clip);
    expect(svg).toContain(" Z");
    expect(svg).toContain('fill="#00b5ef"');
    expect(svg).toContain('stroke="#00b5ef"');
    expect(annotationSvgBody({ shape: "polygon" })).toBe("");
    const project = { ...createProject(), clips: [clip] };
    const restored = validateProject(JSON.parse(JSON.stringify(project)))
      .clips[0];
    expect(restored.linePoints).toEqual(clip.linePoints);
    expect(annotationSvgBody(restored)).toBe(svg);
  });

  it("去除相邻重复点，拒绝顶点不足、共线和超限输入", () => {
    const duplicated = [
      vertices[0],
      vertices[0],
      ...vertices.slice(1),
      vertices[0],
    ];
    expect(polygonAnnotation(duplicated, canvas)?.template).toEqual(
      fixture().template,
    );
    expect(polygonAnnotation(vertices.slice(0, 2), canvas)).toBeNull();
    expect(
      polygonAnnotation(
        [
          { x: 10, y: 10 },
          { x: 10, y: 10 },
          { x: 20, y: 20 },
          { x: 20, y: 20 },
        ],
        canvas,
      ),
    ).toBeNull();
    expect(
      polygonAnnotation(
        [
          { x: 10, y: 10 },
          { x: 20, y: 20 },
          { x: 30, y: 30 },
        ],
        canvas,
      ),
    ).toBeNull();
    const circle = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        x: 320 + Math.cos((index * Math.PI * 2) / count) * 100,
        y: 180 + Math.sin((index * Math.PI * 2) / count) * 100,
      }));
    expect(polygonAnnotation(circle(maxPolygonPoints), canvas)).not.toBeNull();
    expect(polygonAnnotation(circle(maxPolygonPoints + 1), canvas)).toBeNull();
  });

  it("按当前运镜换算指针坐标并限制在画布内", () => {
    const camera = { x: 0.6, y: 0.4, scale: 2 };
    expect(polygonCanvasPoint({ x: 0.5, y: 0.5 }, canvas, camera)).toEqual({
      x: 384,
      y: 144,
    });
    const topLeft = polygonCanvasPoint({ x: 0, y: 0 }, canvas, camera);
    expect(topLeft.x).toBeCloseTo(224);
    expect(topLeft.y).toBeCloseTo(54);
    expect(polygonCanvasPoint({ x: 1, y: 1 }, canvas, camera)).toEqual({
      x: 544,
      y: 234,
    });
    expect(
      polygonCanvasPoint({ x: 1, y: 0 }, canvas, { x: 1, y: 0, scale: 1 }),
    ).toEqual({ x: 640, y: 0 });
  });

  it("PNG 和真实截帧保留凹口且不裁切描边", async () => {
    const root = path.resolve(`test-output/polygon-${Date.now()}`);
    await fs.mkdir(root, { recursive: true });
    const { clip } = fixture();
    clip.duration = 2;
    const image = path.join(root, "annotation.png");
    await rasterizeAnnotation(clip, image);
    const { data, info } = await sharp(image)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const alpha = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
    expect(alpha(39, 39)).toBeGreaterThan(240);
    expect(alpha(149, 109)).toBe(0);
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

    const project = createProject("钢笔导出");
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
    expect(sample(70, 70)[0]).toBeLessThan(60);
    expect(sample(70, 70)[1]).toBeGreaterThan(140);
    expect(sample(70, 70)[2]).toBeGreaterThan(180);
    expect(sample(180, 140)).toEqual([16, 16, 16]);
    expect(sample(20, 20)).toEqual([16, 16, 16]);
  });

  it("自定义笔宽会纳入包围框", () => {
    const result = polygonAnnotation(
      vertices,
      canvas,
      shapeStyleSchema.parse({ strokeWidth: 20 }),
    )!;
    expect(result.template.kind).toBe("shape");
    if (result.template.kind !== "shape") return;
    expect(result.template.size).toEqual({ width: 242, height: 182 });
    expect(result.template.linePoints?.[0]).toEqual({
      x: 21 / 242,
      y: 21 / 182,
    });
  });
});
