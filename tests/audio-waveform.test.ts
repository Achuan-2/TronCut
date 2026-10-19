import { expect, it } from "vitest";
import { newText, type Clip } from "../shared/model";
import { waveformColumns, waveformLevels } from "../shared/audio-waveform";
import {
  WaveformPeakBuilder,
  waveformMaxPeaks,
  waveformSampleRate,
} from "../electron/waveform-peaks";

const clip = (patch: Partial<Clip> = {}): Clip => ({
  ...newText("audio", 0),
  kind: "audio",
  duration: 4,
  ...patch,
});
const columns = (
  peaks: number[],
  source: Clip,
  options: {
    rate?: number;
    zoom?: number;
    left?: number;
    width?: number;
    ratio?: number;
  } = {},
) => {
  const data = {
    peaksPerSecond: options.rate ?? 1,
    peaks: Uint8Array.from(peaks),
  };
  return [
    ...waveformColumns(
      data,
      waveformLevels(data.peaks),
      source,
      peaks.length / data.peaksPerSecond,
      options.zoom ?? 1,
      options.left ?? 0,
      options.width ?? source.duration * (options.zoom ?? 1),
      options.ratio ?? 1,
    ),
  ];
};

it("流式读取不完整 PCM 字节块，保留正负峰值、静音及末尾不足一桶的数据", () => {
  const samples = [0, -0.25, 0.1, 0, 0, 0, ...Array(6).fill(0), -1];
  const pcm = Buffer.alloc(samples.length * 4);
  samples.forEach((value, i) => pcm.writeFloatLE(value, i * 4));
  const builder = new WaveformPeakBuilder(1);
  for (let i = 0; i < pcm.length; i += 7)
    builder.append(pcm.subarray(i, i + 7));
  const result = builder.finish();
  expect(result.peaksPerSecond).toBe(8000);
  expect([...result.peaks]).toEqual([128, 0, 255]);
  const long = new WaveformPeakBuilder(86400);
  expect(
    Math.ceil((86400 * waveformSampleRate) / long.bucketSize),
  ).toBeLessThanOrEqual(waveformMaxPeaks);
});

it("缩小保留瞬时峰值，高 DPI 放大增加列数，滚动仅查询对应的源区间", () => {
  expect(
    columns([0, 0, 0, 0, 255, 0, 0, 0], clip({ duration: 1 }), { rate: 8 }),
  ).toEqual([255]);
  expect(columns([0, 80, 0, 220], clip(), { zoom: 2, ratio: 2 })).toEqual([
    0, 0, 0, 0, 80, 80, 80, 80, 0, 0, 0, 0, 220, 220, 220, 220,
  ]);
  expect(columns([0, 80, 0, 220], clip(), { left: 2, width: 2 })).toEqual([
    0, 220,
  ]);
});

it("裁剪、速度和拼接映射到实际源时间，不显示被跳过的片段", () => {
  expect(
    columns([0, 80, 0, 220, 0], clip({ sourceIn: 1, duration: 2 })),
  ).toEqual([80, 0]);
  expect(
    columns([0, 80, 0, 220, 0], clip({ sourceIn: 1, duration: 2, speed: 2 })),
  ).toEqual([80, 220]);
  expect(
    columns(
      [0, 80, 0, 220],
      clip({
        duration: 2,
        stitch: [
          { sourceIn: 3, duration: 1 },
          { sourceIn: 1, duration: 1 },
        ],
      }),
    ),
  ).toEqual([220, 80]);
  expect(
    columns(
      [100, 0, 255, 0, 255, 0, 200, 255],
      clip({
        duration: 1,
        stitch: [
          { sourceIn: 0, duration: 0.5 },
          { sourceIn: 3, duration: 0.5 },
        ],
      }),
      { rate: 2 },
    ),
  ).toEqual([200]);
});

it("循环跨源结尾仍保留两侧峰值，普通片段的源结尾外保持静音", () => {
  expect(
    columns([30, 240], clip({ sourceIn: 1.5, duration: 2, loop: true })),
  ).toEqual([240, 240]);
  expect(columns([30, 240], clip({ sourceIn: 2, duration: 2 }))).toEqual([
    0, 0,
  ]);
  expect(columns([], clip())).toEqual([0, 0, 0, 0]);
});
