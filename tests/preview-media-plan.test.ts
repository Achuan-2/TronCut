import { expect, it } from "vitest";
import { createProject, newText, type Clip } from "../shared/model";
import { createPreviewMediaPlan } from "../shared/preview-media-plan";

const media = (
  id: string,
  start: number,
  duration = 1,
  assetId = "source",
): Clip => ({
  ...newText("video", start),
  id,
  kind: "video",
  assetId,
  duration,
});

it("相邻剪切复用解码器，重叠片段的槽位在前一片段结束后保持稳定", () => {
  const p = createProject();
  const a = media("a", 0, 1.2),
    b = media("b", 1, 1),
    c = media("c", 2, 1);
  p.clips = [c, b, a];
  const plan = createPreviewMediaPlan(p);
  expect(plan.key(a)).not.toBe(plan.key(b));
  expect(plan.key(c)).toBe(plan.key(a));
  expect(plan.key(b)).not.toBe(plan.key(c));
  p.clips = [media("split-a", 0), media("split-b", 1)];
  const split = createPreviewMediaPlan(p);
  expect(split.key(p.clips[0])).toBe(split.key(p.clips[1]));
});

it("预加载只占用空闲槽位，排除隐藏轨道，并限制时间范围与解码器数", () => {
  const p = createProject();
  const a = media("a", 0),
    b = media("b", 1),
    c = media("c", 1.1, 1, "other");
  p.clips = [
    a,
    b,
    c,
    { ...media("hidden", 1), trackId: "hidden" },
    media("later", 8),
  ];
  const plan = createPreviewMediaPlan(p);
  expect(
    plan.upcoming(0.5, new Set([plan.key(a)]), new Set(["video"])),
  ).toEqual([c]);
  expect(plan.upcoming(1.5, new Set(), new Set(["video"]))).toEqual([]);
  p.clips = Array.from({ length: 20 }, (_, n) =>
    media(`p${n}`, 1, 1, `asset${n}`),
  );
  expect(
    createPreviewMediaPlan(p).upcoming(0, new Set(), new Set(["video"])),
  ).toHaveLength(6);
});
