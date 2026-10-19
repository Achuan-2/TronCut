import { describe, expect, it } from "vitest";
import {
  createProject,
  defaultTransform,
  validateProject,
} from "../shared/model";
import {
  cameraAt,
  clampCamera,
  constrainMoveDelta,
  framePosition,
  resizeTransform,
  setCameraTransform,
} from "../shared/canvas";
import { projectDelta } from "../shared/rotation";

it("Shift 拖动在起步后锁定主方向，越过对角线不换轴，松开后可自由移动", () => {
  expect(constrainMoveDelta({ x: 1, y: 1 }, true)).toEqual({
    x: 0,
    y: 0,
    axis: null,
  });
  const horizontal = constrainMoveDelta({ x: -20, y: 4 }, true);
  expect(horizontal).toEqual({ x: -20, y: 0, axis: "x" });
  expect(constrainMoveDelta({ x: -6, y: 80 }, true, horizontal.axis)).toEqual({
    x: -6,
    y: 0,
    axis: "x",
  });
  const released = constrainMoveDelta({ x: -6, y: 80 }, false, horizontal.axis);
  expect(released).toEqual({ x: -6, y: 80, axis: null });
  expect(constrainMoveDelta({ x: -6, y: 80 }, true, released.axis)).toEqual({
    x: 0,
    y: 80,
    axis: "y",
  });
});

it("九宫格定位让缩放、三轴旋转和倾斜后的外框对齐画布，居中保留深度", () => {
  const canvas = { width: 1000, height: 600 };
  const size = { width: 320, height: 180 };
  for (const value of [
    { ...defaultTransform, scale: 0.5 },
    { ...defaultTransform, scale: 1.4, rotation: 90 },
    {
      ...defaultTransform,
      scale: 1.2,
      rotation: 28,
      rotationX: 30,
      rotationY: -20,
      skew: 25,
      z: 500,
    },
    { ...defaultTransform, scale: 5 },
  ]) {
    const corners = [-1, 1].flatMap((x) =>
      [-1, 1].map((y) =>
        projectDelta(value, {
          x: (x * size.width * value.scale) / 2,
          y: (y * size.height * value.scale) / 2,
        }),
      ),
    );
    for (const horizontal of [0, 0.5, 1] as const) {
      for (const vertical of [0, 0.5, 1] as const) {
        const position = framePosition(
          value,
          size,
          canvas,
          horizontal,
          vertical,
        );
        const xs = corners.map((point) => position.x * canvas.width + point.x);
        const ys = corners.map((point) => position.y * canvas.height + point.y);
        const alignedX =
          horizontal === 0
            ? Math.min(...xs)
            : horizontal === 1
              ? Math.max(...xs)
              : (Math.min(...xs) + Math.max(...xs)) / 2;
        const alignedY =
          vertical === 0
            ? Math.min(...ys)
            : vertical === 1
              ? Math.max(...ys)
              : (Math.min(...ys) + Math.max(...ys)) / 2;
        expect(alignedX).toBeCloseTo(horizontal * canvas.width, 8);
        expect(alignedY).toBeCloseTo(vertical * canvas.height, 8);
        expect({ ...value, ...position }.z).toBe(value.z);
      }
    }
  }
  expect(framePosition(defaultTransform, size, canvas, 1, 0, 90)).toEqual({
    x: 0.91,
    y: 0.16 / 0.6,
  });
});

describe("画布缩放与运镜", () => {
  const size = { width: 400, height: 200 },
    canvas = { width: 1000, height: 500 };
  it("从右下角等比缩放时左上角固定", () => {
    const next = resizeTransform(
      defaultTransform,
      { x: 200, y: 100 },
      { x: 1, y: 1 },
      size,
      canvas,
    );
    expect(next.scale).toBe(1.5);
    expect(next.x * 1000 - (400 * next.scale) / 2).toBe(300);
    expect(next.y * 500 - (200 * next.scale) / 2).toBe(150);
    expect(next.opacity).toBe(1);
  });
  it("旋转后的侧边缩放保持对侧锚点", () => {
    const next = resizeTransform(
      defaultTransform,
      { x: 0, y: 200 },
      { x: 1, y: 0 },
      size,
      canvas,
      90,
    );
    expect(next.scale).toBe(1.5);
    expect(next.x).toBeCloseTo(0.5);
    expect(next.y * 500 - (400 * next.scale) / 2).toBeCloseTo(50);
  });
  it("拖过锚点时仍保持合法尺寸", () => {
    expect(
      resizeTransform(
        defaultTransform,
        { x: -10000, y: -10000 },
        { x: 1, y: 1 },
        size,
        canvas,
      ).scale,
    ).toBe(0.05);
  });
  it("旧工程默认完整画面，运镜自动补起点并平滑插值", () => {
    const original = createProject();
    expect(cameraAt(original, 10)).toEqual(defaultTransform);
    const changed = setCameraTransform(original, { scale: 2, x: 0.75 }, 2);
    expect(changed.camera!.keyframes.map((frame) => frame.time)).toEqual([
      0, 2,
    ]);
    expect(cameraAt(changed, 1)).toEqual({
      x: 0.625,
      y: 0.5,
      scale: 1.5,
      opacity: 1,
    });
    expect(validateProject(JSON.parse(JSON.stringify(changed))).camera).toEqual(
      changed.camera,
    );
    expect(original.camera).toBeUndefined();
  });
  it("取景框限制在画布内，同一时间调整覆盖已有关键帧", () => {
    expect(clampCamera({ ...defaultTransform, x: 0, y: 1, scale: 2 })).toEqual({
      x: 0.25,
      y: 0.75,
      scale: 2,
      opacity: 1,
    });
    const first = setCameraTransform(createProject(), { scale: 2 }, 3);
    const second = setCameraTransform(first, { scale: 4, x: 0.6 }, 3);
    expect(second.camera!.keyframes).toHaveLength(2);
    expect(cameraAt(second, 3).scale).toBe(4);
  });
});
