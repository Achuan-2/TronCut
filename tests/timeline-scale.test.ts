import { expect, it } from "vitest";
import {
  timelineZoomMax,
  timelineZoomMin,
  timelineRulerStep,
  timelineRulerLabel,
  timelineFitZoom,
  timelineZoomFromPercent,
  timelineZoomPercent,
  timelineZoomScroll,
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

it("缩放下限随当前时长变化，短片和多日项目都能完整显示", () => {
  for (const duration of [20, 90, 3600, 86400 * 7]) {
    const minimum = timelineFitZoom(duration, 1224);
    expect(duration * minimum).toBeCloseTo(1200);
    expect(timelineZoomFromPercent(0, minimum)).toBe(minimum);
    expect(timelineZoomFromPercent(100, minimum)).toBeCloseTo(timelineZoomMax);
    expect(timelineRulerStep(minimum, 30) * minimum).toBeGreaterThanOrEqual(75);
  }
});

it("滑杆按比例分配缩放区间，窗口宽度改变后重新换算", () => {
  const minimum = timelineFitZoom(3600, 1224);
  const a = timelineZoomFromPercent(25, minimum);
  const b = timelineZoomFromPercent(50, minimum);
  const c = timelineZoomFromPercent(75, minimum);
  expect(b / a).toBeCloseTo(c / b);
  expect(timelineZoomPercent(a, minimum)).toBeCloseTo(25);
  expect(timelineZoomPercent(b, minimum)).toBeCloseTo(50);
  expect(timelineFitZoom(3600, 2424)).toBeCloseTo(minimum * 2);
});

it("缩放保持可见播放头的位置，播放头不在视窗时将它带回中央", () => {
  expect(timelineZoomScroll(12, 100, 130, 1000, 1000)).toBe(1360);
  expect(timelineZoomScroll(12, 130, 100, 1360, 1000)).toBe(1000);
  expect(timelineZoomScroll(30, 100, 130, 0, 1000)).toBe(3400);
  expect(timelineZoomScroll(0, 100, 130, 1000, 1000)).toBe(0);
});
