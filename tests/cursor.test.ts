import { expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";
import { createProject, defaultTransform } from "../shared/model";
import { defaultCursorStyle, cursorAt } from "../shared/cursor";
import { exportVideo } from "../electron/export";
import { findBinary, runProcess } from "../electron/process";
import { probeMedia } from "../electron/media";
import { saveProject, openProject } from "../electron/project-store";

it("鼠标轨迹随源裁切与变速移动，点击高亮保留真实时间，隐藏鼠标不改源数据", () => {
  const asset = {
    id: "cursor",
    kind: "video" as const,
    path: "video.mp4",
    name: "录屏",
    duration: 4,
    width: 100,
    height: 100,
    hasAudio: false,
    cursor: {
      samples: [
        { time: 1, x: 0.2, y: 0.4, visible: true, click: true },
        { time: 2, x: 0.8, y: 0.4, visible: true, click: false },
      ],
    },
  };
  const clip = {
    id: "clip",
    trackId: "video",
    assetId: asset.id,
    name: "录屏",
    kind: "video" as const,
    start: 4,
    sourceIn: 1,
    duration: 1,
    speed: 2,
    transform: defaultTransform,
    keyframes: [],
    volume: 1,
    podcast: false,
  };
  expect(cursorAt(asset, clip, 1.1)?.click).toBe(true);
  expect(cursorAt(asset, clip, 1.5)?.x).toBeCloseTo(0.5);
  expect(cursorAt(asset, clip, 1.5)?.click).toBe(false);
  expect(
    cursorAt(
      asset,
      { ...clip, cursorStyle: { ...defaultCursorStyle, style: "hidden" } },
      1.5,
    ),
  ).toBeNull();
});

it("真实合成可编辑鼠标且随移动改变像素，独立 JSON 鼠标数据可保存并迁移重开", async () => {
  const root = path.resolve("test-output/cursor");
  await fs.mkdir(root, { recursive: true });
  const source = path.join(root, "screen.mp4");
  await runProcess(findBinary("ffmpeg"), [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=160x100:r=10:d=1",
    "-c:v",
    "libx264",
    source,
  ]);
  const asset = await probeMedia(source);
  asset.cursor = {
    samples: [
      { time: 0, x: 0.2, y: 0.5, visible: true, click: false },
      { time: 0.8, x: 0.8, y: 0.5, visible: true, click: false },
    ],
  };
  const p = createProject("鼠标");
  p.canvas = { width: 160, height: 100, fps: 10, background: "#000000" };
  p.assets = [asset];
  p.exportSettings = { encoder: "software" };
  p.clips = [
    {
      id: "mouse",
      trackId: "video",
      kind: "video",
      assetId: asset.id,
      name: "录屏",
      start: 0,
      duration: 1,
      sourceIn: 0,
      speed: 1,
      volume: 1,
      podcast: false,
      transform: { ...defaultTransform },
      keyframes: [],
      cursorStyle: {
        ...defaultCursorStyle,
        style: "circle",
        size: 20,
        color: "#ff0000",
        smooth: false,
      },
    },
  ];
  const out = path.join(root, "cursor.mp4");
  await exportVideo(
    p,
    out,
    path.join(root, "render"),
    false,
    new AbortController().signal,
    () => {},
  );
  const frame = path.join(root, "frame.png");
  await runProcess(findBinary("ffmpeg"), [
    "-y",
    "-ss",
    "0.4",
    "-i",
    out,
    "-frames:v",
    "1",
    frame,
  ]);
  const [red, green] = await sharp(frame)
    .extract({ left: 80, top: 50, width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer();
  expect(red).toBeGreaterThan(180);
  expect(green).toBeLessThan(40);
  const file = path.join(root, "portable", "cursor.troncut");
  await saveProject(p, file);
  const disk = JSON.parse(await fs.readFile(file, "utf8"));
  expect(disk.assets[0].cursor).toBeUndefined();
  expect(disk.assets[0].cursorPath).toMatch(/^media\//);
  expect((await openProject(file)).assets[0].cursor).toEqual(asset.cursor);
});
