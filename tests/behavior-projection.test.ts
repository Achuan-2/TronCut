import { describe, expect, it } from "vitest";
import { createBehavior, glyphMotion } from "../shared/behaviors";
import { hingeProjection } from "../shared/behavior-projection";

describe("媒体铰链透视", () => {
  it("参考弹簧时钟保留多次正反回摆，而不是只翻开一次", () => {
    const behavior = createBehavior("media-hinge", 5, "image")!;
    const angles = [0.2, 0.5, 1, 1.5].map(
      (time) =>
        glyphMotion({ behaviors: [behavior] }, time, 0, 1, "object").rotationX,
    );
    expect(angles[0]).toBeGreaterThan(20);
    expect(angles[1]).toBeLessThan(-20);
    expect(angles[2]).toBeGreaterThan(5);
    expect(angles[3]).toBeLessThan(-1);
    expect(Math.abs(angles[1])).toBeGreaterThan(Math.abs(angles[2]));
    expect(Math.abs(angles[2])).toBeGreaterThan(Math.abs(angles[3]));
    expect(
      glyphMotion({ behaviors: [behavior] }, 2, 0, 1, "object").perspectiveY,
    ).toBe(0);
  });

  it("四方向的铰链边缘在三维投影中保持不动，自由边会靠近和远离镜头", () => {
    for (const direction of ["left", "right", "top", "bottom"] as const) {
      const behavior = createBehavior("media-hinge", 5, "image")!;
      behavior.incoming.direction = behavior.outgoing.direction = direction;
      const horizontal = ["left", "right"].includes(direction);
      const sign = ["left", "top"].includes(direction) ? -1 : 1;
      const width = 240,
        height = 160,
        length = horizontal ? width : height;
      for (const time of [0.1, 0.5, 1, 1.5, 4.8]) {
        const motion = glyphMotion(
          { behaviors: [behavior] },
          time,
          0,
          1,
          "object",
        );
        const projection = hingeProjection(motion, width, height)!;
        const angle =
          ((horizontal ? motion.rotationY : motion.rotationX) * Math.PI) / 180;
        const edge = (sign * length) / 2;
        const translate = horizontal
          ? projection.translateX
          : projection.translateY;
        const z =
          projection.translateZ +
          (horizontal ? -1 : 1) * edge * Math.sin(angle);
        const projected =
          (translate + edge * Math.cos(angle)) / (1 - z / projection.distance);
        expect(projected, `${direction}/${time}`).toBeCloseTo(edge, 8);
        expect(
          horizontal ? motion.pivotX * width : motion.pivotY * height,
        ).toBeCloseTo(horizontal ? projection.centerX : projection.centerY, 8);
        if (time === 0.5) {
          const freeZ =
            projection.translateZ -
            (horizontal ? -1 : 1) * edge * Math.sin(angle);
          expect(1 / (1 - freeZ / projection.distance)).toBeGreaterThan(1.15);
        }
      }
    }
  });
});
