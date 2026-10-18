import { expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";
import { createProject, newText } from "../shared/model";
import { exportFrame, exportVideo } from "../electron/export";
import { createBehavior } from "../shared/behaviors";
import { saveProject, openProject } from "../electron/project-store";
import { findBinary, runProcess } from "../electron/process";
import { applyCharacterStyle } from "../shared/rich-text";

it("文本框调整后的实际字号可保存重开，并按字号导出", async () => {
  const root = path.resolve(`test-output/text-export-${Date.now()}`);
  const project = createProject("文本框");
  project.canvas = { width: 160, height: 90, fps: 10, background: "#000000" };
  project.exportSettings = { encoder: "software" };
  const small = newText("titles", 0, 0, "M");
  small.duration = 0.5;
  small.style = { ...small.style!, fontSize: 20, outlineWidth: 0 };
  small.textBox = { width: 30, height: 25 };
  small.autoResizeText = true;
  const large = {
    ...small,
    id: "large",
    start: 0.5,
    style: { ...small.style, fontSize: 40 },
    textBox: { width: 60, height: 50 },
  };
  project.clips = [small, large];
  await saveProject(project, path.join(root, "text.troncut"));
  const reopened = await openProject(path.join(root, "text.troncut"));
  expect(reopened.clips).toEqual(project.clips);
  const output = path.join(root, "text.mp4");
  await exportVideo(
    reopened,
    output,
    path.join(root, "render"),
    false,
    AbortSignal.timeout(20000),
    () => {},
  );
  const widths: number[] = [];
  for (const [index, time] of [0.2, 0.7].entries()) {
    const image = path.join(root, `frame-${index}.png`);
    await runProcess(findBinary("ffmpeg"), [
      "-y",
      "-ss",
      String(time),
      "-i",
      output,
      "-frames:v",
      "1",
      image,
    ]);
    const { data, info } = await sharp(image)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const xs: number[] = [],
      ys: number[] = [];
    for (let y = 0; y < info.height; y++)
      for (let x = 0; x < info.width; x++) {
        if (data[(y * info.width + x) * info.channels] > 180) {
          xs.push(x);
          ys.push(y);
        }
      }
    expect(xs.length).toBeGreaterThan(10);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(80, -1);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(45, -1);
    widths.push(Math.max(...xs) - Math.min(...xs));
  }
  expect(widths[1]).toBeGreaterThan(widths[0] * 1.8);
}, 30000);

it("局部字号、字体、颜色和描边保存重开后，在静态及逐字行为导出中保留", async () => {
  const root = path.resolve(`test-output/rich-text-export-${Date.now()}`);
  const project = createProject("局部样式导出");
  project.canvas = { width: 320, height: 180, fps: 10, background: "#000000" };
  project.exportSettings = { encoder: "software" };
  const original = newText("titles", 0, 0, "MM");
  original.duration = 1;
  original.style = { ...original.style!, fontSize: 24, fontFamily: "Arial", color: "#00ff00", outlineWidth: 0 };
  const styled = applyCharacterStyle(original, { start: 1, end: 2 }, { fontSize: 48, fontFamily: "Arial", color: "#ff0000", outline: "#0000ff", outlineWidth: 2 });
  for (const animated of [false, true]) {
    const clip = structuredClone(styled);
    if (animated) {
      const behavior = createBehavior("type-reveal", 1)!;
      behavior.incoming.offset = 0;
      behavior.outgoing.style = "none";
      clip.behaviors = [behavior];
    }
    project.clips = [clip];
    const file = path.join(root, `${animated}.troncut`);
    await saveProject(project, file);
    const reopened = await openProject(file);
    expect(reopened.clips[0].textRuns).toEqual(styled.textRuns);
    const image = path.join(root, `${animated}.png`);
    await exportFrame(reopened, 0.7, image, path.join(root, `${animated}`), AbortSignal.timeout(20000));
    // Exercise the concat stream over a full clip, then inspect the encoded frame.
    const video = path.join(root, `${animated}.mp4`);
    await exportVideo(reopened, video, path.join(root, `video-${animated}`), false, AbortSignal.timeout(20000), () => {});
    await runProcess(findBinary("ffmpeg"), ["-y", "-ss", "0.7", "-i", video, "-frames:v", "1", image]);
    const { data, info } = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const bounds = [[], [], []] as number[][];
    const heights = [[], []] as number[][];
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      const [r, g, b] = data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3);
      if (r > 150 && g < 50 && b < 50) { bounds[0].push(x); heights[0].push(y); }
      if (g > 150 && r < 50 && b < 50) { bounds[1].push(x); heights[1].push(y); }
      if (b > 120 && r < 70 && g < 70) bounds[2].push(x);
    }
    for (const channel of bounds) expect(channel.length).toBeGreaterThan(15);
    expect(Math.min(...bounds[0])).toBeGreaterThan(Math.max(...bounds[1]));
    expect(Math.max(...heights[0]) - Math.min(...heights[0])).toBeGreaterThan((Math.max(...heights[1]) - Math.min(...heights[1])) * 1.7);
  }
}, 30000);

it("文本、字幕和逐字行为导出独立填充，颜色透明度可保存重开且不削弱文字", async () => {
  const root = path.resolve(`test-output/text-fill-export-${Date.now()}`);
  const project = createProject("填充");
  project.canvas = { width: 320, height: 180, fps: 10, background: "#ffffff" };
  const clip = newText("titles", 0, 0, "M");
  clip.duration = 1;
  clip.textBox = { width: 160, height: 60 };
  clip.style = { ...clip.style!, fontSize: 24, outlineWidth: 0 };
  for (const kind of [
    "text",
    "caption",
    "behavior",
    "blue",
    "transparent",
    "disabled",
    "default",
  ] as const) {
    const current = structuredClone(clip);
    // These cases exercise explicitly enabled fills, independent of new-text defaults.
    if (kind !== "default") current.style!.fillEnabled = true;
    if (kind === "caption") current.caption = true;
    if (kind === "behavior") {
      const behavior = createBehavior("type-reveal", current.duration)!;
      behavior.incoming.offset = 0;
      behavior.outgoing.style = "none";
      current.behaviors = [behavior];
    }
    if (kind === "blue")
      current.style = { ...current.style!, fill: "#0000ff", fillOpacity: 0.5 };
    if (kind === "transparent") current.style!.fillOpacity = 0;
    if (kind === "disabled") current.style!.fillEnabled = false;
    project.clips = [current];
    const file = path.join(root, `${kind}.troncut`);
    await saveProject(project, file);
    const reopened = await openProject(file);
    expect(reopened.clips[0].style).toEqual(current.style);
    const image = path.join(root, `${kind}.png`);
    await exportFrame(
      reopened,
      0.5,
      image,
      path.join(root, kind),
      AbortSignal.timeout(20000),
    );
    const { data, info } = await sharp(image)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => [
      ...data.subarray(
        (y * info.width + x) * info.channels,
        (y * info.width + x) * info.channels + 3,
      ),
    ];
    const expected =
      kind === "blue"
        ? [127, 127, 255]
        : kind === "transparent" || kind === "disabled" || kind === "default"
          ? [255, 255, 255]
          : [63, 63, 63];
    pixel(100, 70).forEach((channel, index) =>
      expect(Math.abs(channel - expected[index])).toBeLessThan(7),
    );
    // Fill extends beyond the 160x60 text frame, while the rounded corner stays clear.
    pixel(72, 90).forEach((channel, index) =>
      expect(Math.abs(channel - expected[index])).toBeLessThan(7),
    );
    expect(pixel(68, 54).every((channel) => channel > 240)).toBe(true);
    // The texture's transparent motion margins must not become a giant filled rectangle.
    expect(pixel(30, 30).every((channel) => channel > 248)).toBe(true);
    let brightText = 0;
    for (let y = 78; y < 102; y++)
      for (let x = 148; x < 172; x++)
        if (pixel(x, y).every((channel) => channel > 230)) brightText++;
    expect(brightText).toBeGreaterThan(10);
  }
}, 30000);
