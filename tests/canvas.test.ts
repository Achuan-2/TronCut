import { describe, expect, it } from "vitest";
import {
  createProject,
  defaultTransform,
  validateProject,
} from "../shared/model";
import {
  cameraAt,
  clampCamera,
  resizeTransform,
  setCameraTransform,
} from "../shared/canvas";

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
