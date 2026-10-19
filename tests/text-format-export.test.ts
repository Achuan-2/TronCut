import { expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createProject, newText, type CharacterStyle } from "../shared/model";
import { applyCharacterStyle } from "../shared/rich-text";
import { createBehavior } from "../shared/behaviors";
import { exportFrame } from "../electron/export";
import { openProject, saveProject } from "../electron/project-store";

it("整段、局部及逐字动画的加粗、斜体和下划线保存后实际改变导出像素", async () => {
  const root = path.resolve(`test-output/text-format-export-${Date.now()}`);
  const project = createProject("文字格式");
  project.canvas = { width: 320, height: 180, fps: 10, background: "#000000" };
  const formats: Record<string, CharacterStyle> = {
    regular: { bold: false, italic: false, underline: false },
    bold: { bold: true, italic: false, underline: false },
    italic: { bold: false, italic: true, underline: false },
    underline: { bold: false, italic: false, underline: true },
  };
  for (const route of ["whole", "runs", "animated"] as const) {
    const images: Record<
      string,
      { pixels: Buffer; bright: number; longestRow: number; width: number }
    > = {};
    for (const [name, format] of Object.entries(formats)) {
      let clip = newText("titles", 0, 0, "H H");
      clip.duration = 1;
      clip.style = {
        ...clip.style!,
        fontFamily: "Arial",
        fontSize: 52,
        outlineWidth: 0,
        bold: false,
      };
      clip = applyCharacterStyle(
        clip,
        route === "whole" ? null : { start: 0, end: 3 },
        format,
      );
      if (route === "animated") {
        const behavior = createBehavior("type-reveal", 1)!;
        behavior.incoming.offset = 0;
        behavior.outgoing.style = "none";
        clip.behaviors = [behavior];
      }
      project.clips = [clip];
      const file = path.join(root, `${route}-${name}.troncut`);
      await saveProject(project, file);
      const reopened = await openProject(file);
      expect(reopened.clips[0].style).toEqual(clip.style);
      expect(reopened.clips[0].textRuns).toEqual(clip.textRuns);
      const output = path.join(root, `${route}-${name}.png`);
      await exportFrame(
        reopened,
        0.9,
        output,
        path.join(root, `${route}-${name}`),
        AbortSignal.timeout(20000),
      );
      const { data, info } = await sharp(output)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      let bright = 0,
        longestRow = 0,
        minX = info.width,
        maxX = 0;
      for (let y = 0; y < info.height; y++) {
        let row = 0;
        for (let x = 0; x < info.width; x++)
          if (data[(y * info.width + x) * info.channels] > 180) {
            row++;
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
          }
        bright += row;
        longestRow = Math.max(longestRow, row);
      }
      images[name] = {
        pixels: data,
        bright,
        longestRow,
        width: maxX - minX + 1,
      };
    }
    expect(images.bold.bright, route).toBeGreaterThan(
      images.regular.bright * 1.2,
    );
    expect(images.italic.pixels.equals(images.regular.pixels), route).toBe(
      false,
    );
    expect(images.underline.bright, route).toBeGreaterThan(
      images.regular.bright * 1.05,
    );
    // Underlines also span the space between the letters in both render paths.
    expect(images.underline.longestRow, route).toBeGreaterThan(
      images.regular.longestRow * 1.2,
    );
    expect(images.underline.longestRow, route).toBeGreaterThan(
      images.underline.width * 0.95,
    );
  }
  expect(
    (await fs.readdir(root)).filter((file) => file.endsWith(".png")),
  ).toHaveLength(12);
}, 60000);
