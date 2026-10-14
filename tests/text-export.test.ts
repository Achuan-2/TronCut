import { expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";
import { createProject, newText } from "../shared/model";
import { exportVideo } from "../electron/export";
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
