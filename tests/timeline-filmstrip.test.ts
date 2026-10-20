import { expect, it, vi } from "vitest";
import { newText, type Asset, type Clip } from "../shared/model";
import { timelineFilmstripTiles } from "../shared/timeline-filmstrip";
import { sourceTimeAt } from "../shared/media-segments";
import { TimelineThumbnailLoader } from "../src/timeline-thumbnails";

const asset: Asset = {
  id: "video",
  path: "video.mp4",
  name: "视频",
  kind: "video",
  width: 160,
  height: 90,
  duration: 300,
  hasAudio: true,
};
const clip: Clip = {
  ...newText("video", 2),
  kind: "video",
  sourceIn: 4,
  duration: 100,
  speed: 2,
};

it("长视频只为可见视窗生成缩略图，横向滚动、缩放后源时间跟随裁剪与速度", () => {
  for (const zoom of [20, 80, 2400]) {
    const tiles = timelineFilmstripTiles(
      clip,
      asset,
      zoom,
      60,
      clip.start * zoom + 500,
      900,
    );
    expect(tiles.length).toBeLessThan(24);
    expect(tiles[0].left).toBeLessThanOrEqual(500);
    expect(tiles.at(-1)!.left + tiles.at(-1)!.width).toBeGreaterThanOrEqual(
      Math.min(1400, clip.duration * zoom),
    );
    for (const tile of tiles)
      expect(
        Math.abs(tile.time - sourceTimeAt(clip, tile.left / zoom)),
      ).toBeLessThan(0.101);
  }
  expect(timelineFilmstripTiles(clip, asset, 80, 60, 50000, 900)).toEqual([]);
});

it("拼接、帧定格与循环从正确源区间取帧，图片始终复用同一张缩略图", () => {
  const stitched = {
    ...clip,
    start: 0,
    sourceIn: 0,
    speed: 1,
    duration: 6,
    stitch: [
      { sourceIn: 10, duration: 2 },
      { sourceIn: 12, duration: 2, freeze: true as const },
      { sourceIn: 30, duration: 2 },
    ],
  };
  const tiles = timelineFilmstripTiles(stitched, asset, 100, 60, 0, 600);
  const frozen = tiles.filter(
    (tile) => tile.left / 100 >= 2 && tile.left / 100 < 4,
  );
  expect(frozen.length).toBeGreaterThan(0);
  expect(frozen.every((tile) => tile.time === 12)).toBe(true);
  expect(frozen[0].left).toBe(200);
  expect(frozen.at(-1)!.left + frozen.at(-1)!.width).toBe(400);
  expect(
    tiles.every((tile) => tile.left >= 200 || tile.left + tile.width <= 200),
  ).toBe(true);
  expect(tiles.at(-1)!.time).toBeGreaterThanOrEqual(30);
  const loop = timelineFilmstripTiles(
    { ...clip, start: 0, sourceIn: 299, loop: true },
    asset,
    80,
    60,
    0,
    900,
  );
  expect(loop.every((tile) => tile.time < 300)).toBe(true);
  expect(loop.some((tile) => tile.time < 20)).toBe(true);
  const images = timelineFilmstripTiles(
    { ...clip, kind: "image" },
    { ...asset, kind: "image", duration: 0 },
    80,
    60,
    200,
    900,
  );
  expect(images.every((tile) => tile.time === 0)).toBe(true);
  expect(
    timelineFilmstripTiles(clip, { ...asset, missing: true }, 80, 60, 200, 900),
  ).toEqual([]);
});

it("滚动离开后丢弃排队任务，解码并发不超过两个，当前视窗无需等待旧队列", async () => {
  const finishes: ((value: string) => void)[] = [];
  const decode = vi.fn(
    () => new Promise<string>((resolve) => finishes.push(resolve)),
  );
  const loader = new TimelineThumbnailLoader(decode);
  const releases = Array.from({ length: 100 }, (_, time) =>
    loader.subscribe(asset, time, () => {}),
  );
  expect(decode).toHaveBeenCalledTimes(2);
  releases.forEach((release) => release());
  const current = vi.fn();
  loader.subscribe(asset, 200, current);
  finishes[0]("old");
  await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(3));
  expect(decode.mock.calls[2]).toEqual([asset, 200]);
  finishes[1]("old-two");
  finishes[2]("visible");
  await vi.waitFor(() => expect(current).toHaveBeenCalledWith("visible"));
  expect(decode).toHaveBeenCalledTimes(3);
});

it("相同源帧合并请求并缓存，素材更新与失败重试不会复用旧图", async () => {
  const decode = vi.fn(async () => "frame");
  const loader = new TimelineThumbnailLoader(decode);
  const listener = vi.fn();
  loader.subscribe(asset, 1, listener);
  loader.subscribe(asset, 1, listener);
  await vi.waitFor(() => expect(listener).toHaveBeenCalledWith("frame"));
  loader.subscribe(asset, 1, listener);
  expect(decode).toHaveBeenCalledTimes(1);
  loader.subscribe({ ...asset }, 1, listener);
  await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(2));
  decode.mockRejectedValueOnce(new Error("offline"));
  loader.subscribe(asset, 2, listener);
  await vi.waitFor(() => expect(listener).toHaveBeenCalledWith(null));
  loader.subscribe(asset, 2, listener);
  await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(4));
});

it("同档缩放复用源帧，跨档只增加细网格帧，缩回不重新解码", async () => {
  const video = { ...clip, start: 0, duration: 6 };
  const plan = (zoom: number) =>
    timelineFilmstripTiles(video, asset, zoom, 60, 0, 3000);
  const coarse = plan(80);
  expect(plan(100).map((tile) => tile.time)).toEqual(
    coarse.map((tile) => tile.time),
  );
  expect(plan(100).map((tile) => tile.left)).not.toEqual(
    coarse.map((tile) => tile.left),
  );
  const fine = plan(200);
  const fineTimes = new Set(fine.map((tile) => tile.time));
  expect(coarse.every((tile) => fineTimes.has(tile.time))).toBe(true);
  expect(fineTimes.size).toBeGreaterThan(coarse.length);
  const decode = vi.fn(async (_asset: Asset, time: number) => "frame-" + time);
  const loader = new TimelineThumbnailLoader(decode);
  const load = async (tiles: ReturnType<typeof plan>) => {
    await Promise.all(
      tiles.map(
        (tile) =>
          new Promise((resolve) => loader.subscribe(asset, tile.time, resolve)),
      ),
    );
  };
  await load(fine);
  const count = decode.mock.calls.length;
  await load(coarse);
  await load(plan(100));
  await load(plan(200));
  expect(decode).toHaveBeenCalledTimes(count);
});

it("补充细网格帧时立即复用同一源区间的缓存，剪掉的画面和更新素材不能作为替代图", async () => {
  const loader = new TimelineThumbnailLoader(
    async (_asset, time) => "frame-" + time,
  );
  await Promise.all(
    [2, 8].map(
      (time) =>
        new Promise((resolve) => loader.subscribe(asset, time, resolve)),
    ),
  );
  expect(loader.cached(asset, 3, 2, 6)).toBe("frame-2");
  expect(loader.cached(asset, 7, 6, 10)).toBe("frame-8");
  expect(loader.cached(asset, 4, 3, 6)).toBeNull();
  expect(loader.cached(asset, 2)).toBe("frame-2");
  expect(loader.cached(asset, 3)).toBeNull();
  expect(loader.cached({ ...asset }, 3, 0, 10)).toBeNull();
});

it("非整数时长循环每轮复用同一组帧，裁剪边界不出现空隙", () => {
  const loopAsset = { ...asset, duration: 3.3 };
  const looping = {
    ...clip,
    start: 0,
    sourceIn: 0.35,
    duration: 50,
    speed: 1,
    loop: true,
  };
  const first = timelineFilmstripTiles(looping, loopAsset, 80, 60, 100, 700);
  const later = timelineFilmstripTiles(looping, loopAsset, 80, 60, 1900, 700);
  const times = new Set(
    first.filter((tile) => tile.time !== 0.35).map((tile) => tile.time),
  );
  expect(later.every((tile) => times.has(tile.time))).toBe(true);
  expect(times.size).toBeLessThan(5);
  for (let index = 1; index < later.length; index++)
    expect(later[index].left).toBeCloseTo(
      later[index - 1].left + later[index - 1].width,
      7,
    );
  const cut = { ...clip, start: 0, sourceIn: 4.3, speed: 1, duration: 5 };
  const tiles = timelineFilmstripTiles(cut, asset, 100, 60, 0, 1000);
  expect(tiles[0].left).toBe(0);
  expect(tiles[0].time).toBe(4.3);
  expect(tiles.every((tile) => tile.time >= 4.3 && tile.time < 9.3)).toBe(true);
  for (let index = 1; index < tiles.length; index++)
    expect(tiles[index].left).toBeCloseTo(
      tiles[index - 1].left + tiles[index - 1].width,
      7,
    );
  expect(tiles.at(-1)!.left + tiles.at(-1)!.width).toBeCloseTo(500, 7);
});
