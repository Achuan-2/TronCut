import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { annotationClip, sketchPresets } from "../shared/annotations";
import {
  annotationPaths,
  annotationSvgBody,
  drawingProgress,
  shapeStyleSchema,
} from "../shared/annotation-style";
import {
  drawingStrokesToCanvas,
  fitFreehandStrokes,
  freehandAnnotation,
  penBrushes,
  type PenSettings,
} from "../shared/freehand";
import {
  animationRanges,
  drawingAnimationRanges,
  retimeAnimation,
} from "../shared/animation-ranges";
import {
  pasteAnimation,
  removeAnimation,
  setAnimationEasing,
  snapshotAnimation,
} from "../shared/animation-edit";
import {
  createProject,
  defaultTransform,
  validateProject,
} from "../shared/model";
import { changeSpeed, splitClip, transformAt } from "../shared/editor";

const settings: PenSettings = {
  color: "#ff2020",
  width: 8,
  brush: "round",
  animate: true,
  duration: 2,
};
function fixture() {
  const result = freehandAnnotation(
    [
      {
        points: [
          { x: 20, y: 30 },
          { x: 120, y: 30 },
        ],
        style: shapeStyleSchema.parse({
          stroke: "#ff0000",
          brush: "round",
          strokeWidth: 8,
        }),
      },
      {
        points: [
          { x: 20, y: 100 },
          { x: 120, y: 100 },
        ],
        style: shapeStyleSchema.parse({
          stroke: "#00ff00",
          brush: "marker",
          strokeWidth: 12,
        }),
      },
    ],
    settings,
    { width: 320, height: 180 },
  )!;
  const clip = annotationClip(result.template, "titles", 0);
  clip.transform = { ...clip.transform, ...result.position };
  clip.duration = 5;
  return clip;
}

describe("多笔涂鸦与绘制动画", () => {
  it("一次绘制只创建一个对象，保留抬笔、各笔颜色和笔刷，并按笔画依次播放", () => {
    const clip = fixture();
    expect(annotationPaths(clip)).toHaveLength(2);
    const first = annotationSvgBody(clip, 0.5);
    expect(first).toContain("#ff0000");
    expect(first).not.toContain("#00ff00");
    expect(first.match(/M/g) ?? []).toHaveLength(1);
    expect(annotationSvgBody(clip, 1)).toContain("#00ff00");
    expect(annotationSvgBody(clip, 0)).toBe("");
    const project = { ...createProject(), clips: [clip] };
    expect(
      validateProject(JSON.parse(JSON.stringify(project))).clips[0].drawing,
    ).toEqual(clip.drawing);
    expect(freehandAnnotation([], settings, project.canvas)).toBeNull();
  });

  it("绘制箭头独立移动、改变起止时间，允许与缩放平移动画重叠", () => {
    const clip = fixture();
    clip.keyframes = [
      { time: 0, value: clip.transform },
      {
        time: 3,
        value: { ...clip.transform, x: 0.8, scale: 1.5 },
        animation: true,
      },
    ];
    const range = drawingAnimationRanges(clip)[0];
    const moved = retimeAnimation(clip, range, "move", 1, 30);
    expect(moved.drawing).toMatchObject({ delay: 1, duration: 2 });
    const resized = retimeAnimation(
      moved,
      drawingAnimationRanges(moved)[0],
      "end",
      1,
      30,
    );
    expect(resized.drawing).toMatchObject({ delay: 1, duration: 3 });
    expect(animationRanges(resized)).toEqual(animationRanges(clip));
    expect(resized.keyframes).toEqual(clip.keyframes);
    expect(transformAt(resized, 1.5)).toEqual(transformAt(clip, 1.5));
    expect(drawingProgress(resized, 1)).toBe(0);
    expect(drawingProgress(resized, 2.5)).toBe(0.5);
    expect(
      retimeAnimation(
        resized,
        drawingAnimationRanges(resized)[0],
        "end",
        100,
        30,
      ).drawing?.duration,
    ).toBe(4);
    const shortest = retimeAnimation(clip, range, "end", -100, 30);
    expect(shortest.drawing?.duration).toBeCloseTo(1 / 30);
  });

  it("箭头缓动、复制粘贴和删除只修改绘制通道，内置草图同样支持", () => {
    const clip = fixture();
    const range = drawingAnimationRanges(clip)[0];
    const eased = setAnimationEasing(clip, range, "exponential");
    expect(drawingProgress(eased, 0.5)).toBeLessThan(
      drawingProgress(clip, 0.5),
    );
    const copied = snapshotAnimation(eased, range)!;
    const target = annotationClip(sketchPresets[0].template, "titles", 0);
    target.duration = 5;
    const pasted = pasteAnimation(target, copied, 1);
    expect(pasted.drawing).toMatchObject({
      delay: 1,
      duration: 2,
      easing: "exponential",
    });
    expect(pasted.keyframes).toEqual(target.keyframes);
    const removed = removeAnimation(pasted, drawingAnimationRanges(pasted)[0]);
    expect(drawingAnimationRanges(removed)).toEqual([]);
    expect(drawingProgress(removed, 0)).toBe(1);
    expect(
      pasteAnimation({ ...target, drawing: undefined }, copied, 0).drawing,
    ).toBeUndefined();
  });

  it("拆分、变速后箭头与笔迹进度一致，截断端点不可拖动", () => {
    const clip = fixture();
    const project = { ...createProject(), clips: [clip] };
    const right = splitClip(project, clip.id, 0.5).clips[1];
    expect(drawingProgress(right, 0.5)).toBe(0.5);
    expect(drawingAnimationRanges(right)[0]).toMatchObject({
      start: 0,
      end: 1.5,
      hasStart: false,
      hasEnd: true,
    });
    expect(
      retimeAnimation(
        right,
        drawingAnimationRanges(right)[0],
        "start",
        0.3,
        30,
      ),
    ).toBe(right);
    const faster = changeSpeed(right, 2);
    expect(drawingProgress(faster, 0.25)).toBe(0.5);
    expect(drawingAnimationRanges(faster)[0].end).toBe(0.75);
  });

  it("所有笔刷均可栅格化，导出各笔保留颜色且抬笔处没有连接线", async () => {
    const clip = fixture();
    const svg = (body: string, width: number, height: number) =>
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`,
      );
    const images: Buffer[] = [];
    for (const brush of penBrushes) {
      const brushClip = {
        ...clip,
        drawing: {
          ...clip.drawing!,
          strokes: clip.drawing!.strokes!.map((stroke) => ({
            ...stroke,
            style: { ...stroke.style!, brush: brush.id },
          })),
        },
      };
      const rendered = await sharp(
        svg(
          annotationSvgBody(brushClip),
          clip.shapeSize!.width,
          clip.shapeSize!.height,
        ),
      )
        .ensureAlpha()
        .raw()
        .toBuffer();
      expect(rendered.some((value) => value > 0)).toBe(true);
      images.push(rendered);
    }
    expect(new Set(images.map((data) => data.toString("base64"))).size).toBe(
      penBrushes.length,
    );
    const { data, info } = await sharp(
      svg(
        annotationSvgBody(clip),
        clip.shapeSize!.width,
        clip.shapeSize!.height,
      ),
    )
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const alpha = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
    expect(alpha(63, 9)).toBe(255);
    expect(alpha(63, 79)).toBeGreaterThan(0);
    expect(alpha(63, 44)).toBe(0);
  });
});

it("已有涂鸦进入画笔后追加路径，重新归一化包围框仍保持原有画面位置", () => {
  const canvas = { width: 640, height: 360 };
  const style = shapeStyleSchema.parse({
    stroke: settings.color,
    strokeWidth: settings.width,
    brush: settings.brush,
    fillEnabled: false,
  });
  const initial = [
    {
      points: [
        { x: 100, y: 80 },
        { x: 200, y: 140 },
      ],
      style,
    },
  ];
  const result = freehandAnnotation(initial, settings, canvas)!;
  const clip = {
    ...annotationClip(result.template, "titles", 0),
    id: "doodle",
    duration: 5,
    transform: {
      ...defaultTransform,
      x: result.position.x,
      y: result.position.y,
    },
  };
  const before = drawingStrokesToCanvas(clip, canvas, 0);
  for (let index = 0; index < before[0].points.length; index++) {
    expect(before[0].points[index].x).toBeCloseTo(initial[0].points[index].x);
    expect(before[0].points[index].y).toBeCloseTo(initial[0].points[index].y);
  }
  const transformed = {
    ...clip,
    transform: {
      ...clip.transform,
      scale: 0.75,
      rotation: 25,
      scaleX: 1.2,
    },
  };
  const transformedBefore = drawingStrokesToCanvas(transformed, canvas, 0);
  const appended = [
    ...transformedBefore,
    {
      points: [
        { x: 500, y: 300 },
        { x: 580, y: 100 },
      ],
      style,
    },
  ];
  const updated = fitFreehandStrokes(
    transformed,
    appended,
    canvas,
    0,
    settings.width,
  );
  expect(updated.drawing?.strokes).toHaveLength(2);
  expect(updated.shapeSize!.width).toBeGreaterThan(clip.shapeSize!.width);
  expect(updated.shapeSize!.height).toBeGreaterThan(clip.shapeSize!.height);

  const roundTrip = drawingStrokesToCanvas(updated, canvas, 0);
  for (let stroke = 0; stroke < appended.length; stroke++)
    for (let point = 0; point < appended[stroke].points.length; point++) {
      expect(roundTrip[stroke].points[point].x).toBeCloseTo(
        appended[stroke].points[point].x,
      );
      expect(roundTrip[stroke].points[point].y).toBeCloseTo(
        appended[stroke].points[point].y,
      );
    }
});
