import { expect, it } from "vitest";
import {
  timelineZoomMax,
  timelineZoomMin,
  timelineRulerStep,
  timelineRulerLabel,
} from "../shared/timeline-scale";

it("时间线缩小保持刻度可读，放大按帧划分并保留帧号", () => {
  expect(timelineRulerStep(timelineZoomMax, 30)).toBe(1 / 30);
  expect(timelineRulerLabel(10 + 1 / 30, 30, 1 / 30)).toBe("00:10:01");
  for (let fps = 1; fps <= 120; fps++) {
    for (const zoom of [
      timelineZoomMin,
      0.2,
      0.5,
      1,
      2,
      5,
      10,
      15,
      65,
      200,
      800,
      timelineZoomMax,
    ]) {
      const step = timelineRulerStep(zoom, fps);
      expect(step * fps).toBeCloseTo(Math.round(step * fps));
      expect(step * zoom).toBeGreaterThanOrEqual(75 - 1e-8);
      if (step >= 1) expect(Number.isInteger(step)).toBe(true);
    }
  }
  expect(timelineRulerLabel(65, 30, 2)).toBe("01:05");
  expect(timelineRulerStep(timelineZoomMin, 30)).toBe(900);
  expect(timelineRulerLabel(3600, 30, 900)).toBe("60:00");
});
