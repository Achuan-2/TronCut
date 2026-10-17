import { expect, it } from "vitest";
import { newText, type Asset, type Clip } from "../shared/model";
import { clipNeedsPreviewFrameAt } from "../shared/preview-motion";

const asset: Asset = {
  id: "image",
  name: "image.png",
  path: "image.png",
  kind: "image",
  duration: 5,
  width: 400,
  height: 200,
  hasAudio: false,
};

it("静态文字、图片和形状不参与每帧预览更新", () => {
  expect(clipNeedsPreviewFrameAt(newText("titles", 0), undefined, 1)).toBe(
    false,
  );
  const image = {
    ...newText("titles", 0),
    kind: "image" as const,
    assetId: asset.id,
  };
  expect(clipNeedsPreviewFrameAt(image, asset, 1)).toBe(false);
});

it("只在关键帧、淡入淡出和行为实际运动区间更新，静止后恢复稳定", () => {
  const base = newText("titles", 0);
  expect(
    clipNeedsPreviewFrameAt(
      {
        ...base,
        keyframes: [
          { time: 0, value: base.transform },
          { time: 1, value: { ...base.transform, x: 0.7 } },
        ],
      },
      undefined,
      0.5,
    ),
  ).toBe(true);
  expect(
    clipNeedsPreviewFrameAt(
      {
        ...base,
        keyframes: [
          { time: 0, value: base.transform },
          { time: 1, value: { ...base.transform, x: 0.7 } },
        ],
      },
      undefined,
      2,
    ),
  ).toBe(false);
  expect(
    clipNeedsPreviewFrameAt({ ...base, fadeIn: 1 }, undefined, 0.5),
  ).toBe(true);
  expect(
    clipNeedsPreviewFrameAt({ ...base, fadeIn: 1 }, undefined, 2),
  ).toBe(false);
});

it("转场、绘制、游标轨迹和高分辨率视频持续需要播放更新", () => {
  const base = newText("titles", 0);
  expect(
    clipNeedsPreviewFrameAt(
      {
        ...base,
        transitions: {
          incoming: {
            type: "smooth-slide",
            duration: 1,
            enabled: true,
            reverse: false,
          },
        },
      } as Clip,
      undefined,
      2,
    ),
  ).toBe(true);
  expect(
    clipNeedsPreviewFrameAt(
      { ...base, drawing: { ...base.drawing!, enabled: true } },
      undefined,
      2,
    ),
  ).toBe(true);
  expect(
    clipNeedsPreviewFrameAt(
      { ...base, kind: "video", assetId: "video" },
      {
        ...asset,
        kind: "video",
        cursor: {
          samples: [
            {
              time: 0,
              x: 0.5,
              y: 0.5,
              visible: true,
              click: false,
            },
          ],
        },
      },
      2,
    ),
  ).toBe(true);
});
