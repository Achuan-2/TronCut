import { expect, it } from "vitest";
import {
  timelineZoomMax,
  timelineRulerStep,
  timelineRulerLabel,
} from "../shared/timeline-scale";

it("高倍时间线按帧划分，标签间距可读并保留帧号", () => {
  expect(timelineRulerStep(timelineZoomMax, 30)).toBe(1 / 30);
  expect(timelineRulerLabel(10 + 1 / 30, 30, 1 / 30)).toBe("00:10:01");
  for (let fps = 1; fps <= 120; fps++) {
    for (const zoom of [15, 65, 200, 800, timelineZoomMax]) {
      const step = timelineRulerStep(zoom, fps);
      expect(step * fps).toBeCloseTo(Math.round(step * fps));
      expect(step * zoom).toBeGreaterThanOrEqual(75 - 1e-8);
      if (step >= 1) expect(Number.isInteger(step)).toBe(true);
    }
  }
  expect(timelineRulerLabel(65, 30, 2)).toBe("01:05");
});
