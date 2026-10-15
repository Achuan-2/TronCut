import { expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";
import { createProject, newText } from "../shared/model";
import { exportFrame, exportVideo } from "../electron/export";
import { createBehavior } from "../shared/behaviors";
import { saveProject, openProject } from "../electron/project-store";
import { findBinary, runProcess } from "../electron/process";

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
  ] as const) {
    const current = structuredClone(clip);
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
        : kind === "transparent"
          ? [255, 255, 255]
          : [63, 63, 63];
    pixel(100, 70).forEach((channel, index) =>
      expect(Math.abs(channel - expected[index])).toBeLessThan(7),
    );
    // The texture's transparent motion margins must not become a giant filled rectangle.
    expect(pixel(30, 30).every((channel) => channel > 248)).toBe(true);
    let brightText = 0;
    for (let y = 78; y < 102; y++)
      for (let x = 148; x < 172; x++)
        if (pixel(x, y).every((channel) => channel > 230)) brightText++;
    expect(brightText).toBeGreaterThan(10);
  }
}, 30000);
