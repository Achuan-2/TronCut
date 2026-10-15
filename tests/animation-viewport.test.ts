import { expect, it } from "vitest";
import { visibleAnimationRanges } from "../shared/animation-ranges";

it("动画视口包括跨边界和覆盖整个视口的区间，并保留原始序号", () => {
  const ranges = [
    { start: 0, end: 100, hasStart: true, hasEnd: true },
    { start: 110, end: 120, hasStart: true, hasEnd: true },
    { start: 130, end: 140, hasStart: true, hasEnd: true },
  ];
  expect(visibleAnimationRanges(ranges, 40, 50)).toEqual([
    { range: ranges[0], index: 0 },
  ]);
  expect(
    visibleAnimationRanges(ranges, 100, 110).map((entry) => entry.index),
  ).toEqual([0, 1]);
  expect(visibleAnimationRanges(ranges, 101, 109)).toEqual([]);
  expect(visibleAnimationRanges(ranges, 200, 210, 1)).toEqual([
    { range: ranges[1], index: 1 },
  ]);
  expect(visibleAnimationRanges([], 0, 1)).toEqual([]);
});

it("上万动画区间查询与线性结果一致，离开视口的拖动目标仍挂载", () => {
  const ranges = Array.from({ length: 10000 }, (_, i) => ({
    start: i * 2,
    end: i * 2 + 1,
    hasStart: true,
    hasEnd: true,
  }));
  for (let i = 0; i < 100; i++) {
    const start = i * 199,
      end = start + 20;
    const expected = ranges.flatMap((range, index) =>
      range.end >= start && range.start <= end ? [index] : [],
    );
    expect(
      visibleAnimationRanges(ranges, start, end).map((entry) => entry.index),
    ).toEqual(expected);
    const pinned = 9999;
    expect(
      visibleAnimationRanges(ranges, start, end, pinned).map(
        (entry) => entry.index,
      ),
    ).toEqual([...new Set([...expected, pinned])].sort((a, b) => a - b));
  }
});
