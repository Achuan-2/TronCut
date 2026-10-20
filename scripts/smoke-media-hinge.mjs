import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

// Use the real videos/projects produced by tests/media-hinge-export.test.ts.
if (!process.argv[2])
  throw new Error(
    "Pass a test-output/media-hinge-export-<timestamp> directory.",
  );
const source = path.resolve(process.argv[2]);
const evidence = JSON.parse(
  await fs.readFile(path.join(source, "measurements.json"), "utf8"),
);
const root = path.resolve(`test-output/media-hinge-ui-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const mask = async (input) => {
  const { data, info } = await sharp(input)
    .resize(320, 180)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return Uint8Array.from({ length: 320 * 180 }, (_, index) =>
    data[index * info.channels] > 180 ? 1 : 0,
  );
};
const errors = [],
  results = [];
for (const { direction, start = 0 } of evidence.results) {
  const profile = path.join(root, direction);
  await fs.mkdir(profile, { recursive: true });
  await fs.writeFile(
    path.join(profile, "preferences.json"),
    JSON.stringify({
      storage: {
        projectDirectory: path.join(profile, "projects"),
        backupDirectory: path.join(profile, "backups"),
      },
    }),
  );
  const env = {
    ...process.env,
    FRAMECRAFT_SMOKE: "1",
    FRAMECRAFT_USER_DATA: profile,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: [".", path.join(source, `${direction}.troncut`)],
    env,
  });
  try {
    const page = await app.firstWindow();
    page.on("pageerror", (error) => errors.push(error.message));
    await expect(page.locator(".timeline-clip")).toHaveCount(1);
    for (const time of evidence.times) {
      await page
        .getByLabel("播放进度", { exact: true })
        .evaluate((input, value) => {
          Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
          ).set.call(input, String(value));
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }, time + start);
      const layer = page.locator(".preview-layer");
      await expect(layer).toHaveCSS("opacity", "1");
      if (time < 2 || time > 4.4)
        await expect
          .poll(() => layer.getAttribute("style"))
          .toContain("perspective(");
      else
        await expect
          .poll(() => layer.getAttribute("style"))
          .not.toContain("perspective(");
      const expected = await mask(
        path.join(source, `${direction}-${time}.png`),
      );
      let overlap = 0;
      let rawOverlap = 0,
        alignment = { x: 0, y: 0 };
      // Image load and React seek may settle after the style update.
      await expect
        .poll(
          async () => {
            const png = await page.locator(".canvas").screenshot();
            const actual = await mask(png);
            const count =
              actual.reduce((sum, value) => sum + value, 0) +
              expected.reduce((sum, value) => sum + value, 0);
            overlap = 0;
            // FFmpeg's integer overlay origin and resized CSS pixels can differ
            // by up to 2px; require matching shape within this bounded offset.
            for (let dy = -2; dy <= 2; dy++)
              for (let dx = -2; dx <= 2; dx++) {
                let intersection = 0;
                for (let y = Math.max(0, -dy); y < Math.min(180, 180 - dy); y++)
                  for (
                    let x = Math.max(0, -dx);
                    x < Math.min(320, 320 - dx);
                    x++
                  )
                    intersection +=
                      actual[y * 320 + x] && expected[(y + dy) * 320 + x + dx];
                const score = intersection / Math.max(1, count - intersection);
                if (!dx && !dy) rawOverlap = score;
                if (score > overlap) {
                  overlap = score;
                  alignment = { x: dx, y: dy };
                }
              }
            await fs.writeFile(
              path.join(root, `${direction}-${time}.png`),
              png,
            );
            return overlap;
          },
          { timeout: 10000 },
        )
        .toBeGreaterThan(0.94);
      results.push({
        direction,
        time,
        silhouetteIoU: overlap,
        rawIoU: rawOverlap,
        alignment,
      });
    }
    if (direction === "bottom") {
      await page
        .locator(".tool-rail")
        .getByRole("button", { name: "行为", exact: true })
        .click();
      await page.getByRole("tab", { name: "媒体", exact: true }).click();
      const card = page.getByRole("button", { name: "铰链", exact: true });
      await card.hover();
      await expect
        .poll(() => card.locator(".behavior-card-media").getAttribute("style"))
        .toContain("perspective(");
      await expect
        .poll(
          async () =>
            /rotateX\(-/.test(
              await card.locator(".behavior-card-media").getAttribute("style"),
            ),
          { intervals: [16, 32], timeout: 6000 },
        )
        .toBe(true);
      await page.screenshot({ path: path.join(root, "hinge-preview.png") });
    }
  } catch (error) {
    await (
      await app.firstWindow()
    )
      .screenshot({ path: path.join(root, `${direction}-failure.png`) })
      .catch(() => {});
    throw error;
  } finally {
    await app.close();
  }
}
expect(errors).toEqual([]);
await fs.writeFile(
  path.join(root, "results.json"),
  JSON.stringify({ source, results, errors }, null, 2),
);
console.log(
  JSON.stringify({
    root,
    samples: results.length,
    minimumIoU: Math.min(...results.map((item) => item.silhouetteIoU)),
    minimumRawIoU: Math.min(...results.map((item) => item.rawIoU)),
    rendererErrors: errors,
  }),
);
