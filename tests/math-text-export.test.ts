import { expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createProject, newText } from "../shared/model";
import { createBehavior } from "../shared/behaviors";
import { applyCharacterStyle } from "../shared/rich-text";
import { exportFrame, exportVideo } from "../electron/export";
import { saveProject, openProject } from "../electron/project-store";
import { findBinary, runProcess } from "../electron/process";

async function colorPixels(file: string) {
  const { data, info } = await sharp(file)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let red = 0,
    green = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i] > 150 && data[i + 1] < 80 && data[i + 2] < 80) red++;
    if (data[i + 1] > 150 && data[i] < 80 && data[i + 2] < 80) green++;
  }
  return { red, green };
}

it("公式源码和局部颜色保存重开，截帧与逐字行为视频导出保留数学排版和颜色", async () => {
  const root = path.resolve(`test-output/math-text-export-${Date.now()}`);
  await fs.mkdir(root, { recursive: true });
  const project = createProject("公式导出");
  project.canvas = { width: 480, height: 270, fps: 10, background: "#000000" };
  project.exportSettings = { encoder: "software" };
  let clip = newText(
    "titles",
    0,
    0,
    "$x^2$ + $y_1$\n$$\\frac{a}{b}+\\textcolor{red}{\\sqrt{x}}$$",
  );
  clip.duration = 1;
  clip.style = {
    ...clip.style!,
    fontSize: 36,
    color: "#00ff00",
    outlineWidth: 1,
    outline: "#111111",
    fillEnabled: false,
  };
  clip = applyCharacterStyle(clip, { start: 1, end: 4 }, { color: "#ff0000" });
  for (const animated of [false, true]) {
    const current = structuredClone(clip);
    if (animated) {
      const behavior = createBehavior("type-reveal", 1)!;
      behavior.incoming.offset = 0;
      behavior.outgoing.style = "none";
      current.behaviors = [behavior];
    }
    project.clips = [current];
    const file = path.join(root, `${animated}.troncut`);
    await saveProject(project, file);
    const reopened = await openProject(file);
    expect(reopened.clips[0].text).toBe(clip.text);
    expect(reopened.clips[0].textRuns).toEqual(clip.textRuns);
    const frame = path.join(root, `${animated}.png`);
    await exportFrame(
      reopened,
      0.9,
      frame,
      path.join(root, `frame-${animated}`),
      AbortSignal.timeout(20000),
    );
    let colors = await colorPixels(frame);
    expect(colors.red).toBeGreaterThan(80);
    expect(colors.green).toBeGreaterThan(80);
    const video = path.join(root, `${animated}.mp4`);
    await exportVideo(
      reopened,
      video,
      path.join(root, `video-${animated}`),
      false,
      AbortSignal.timeout(20000),
      () => {},
    );
    const extracted = path.join(root, `${animated}-video.png`);
    await runProcess(findBinary("ffmpeg"), [
      "-y",
      "-ss",
      "0.9",
      "-i",
      video,
      "-frames:v",
      "1",
      extracted,
    ]);
    colors = await colorPixels(extracted);
    expect(colors.red).toBeGreaterThan(50);
    expect(colors.green).toBeGreaterThan(50);
  }
}, 30000);
