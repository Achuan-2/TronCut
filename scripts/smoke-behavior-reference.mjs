import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(`test-output/behavior-reference-ui-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const bundle = await build({
  stdin: {
    contents:
      'export { createProject, newText } from "./shared/model"; export { behaviorPresets, createBehavior, glyphMotion } from "./shared/behaviors";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { createProject, newText, behaviorPresets, createBehavior, glyphMotion } =
  await import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
  );
const project = createProject("行为预览回归");
project.clips = behaviorPresets.map((preset, index) => ({
  ...newText(project.tracks[0].id, index * 5, 0, "ABC"),
  name: preset.name,
  behaviors: [createBehavior(preset.id, 5)],
}));
const file = path.join(root, "project.troncut");
await fs.writeFile(file, JSON.stringify(project));
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: path.join(root, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [".", file], env });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // The timeline virtualizes clips outside the visible viewport.
  await expect(page.locator(".timeline-clip.text").first()).toBeVisible();
  await page
    .locator(".tool-rail")
    .getByRole("button", { name: "行为", exact: true })
    .click();
  await expect(page.locator(".behavior-card").first()).toContainText("浮现");
  const seek = async (time) => {
    await page
      .getByLabel("播放进度", { exact: true })
      .evaluate((input, value) => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        ).set.call(input, String(value));
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }, time);
  };
  let samples = 0;
  for (const clip of project.clips) {
    for (const local of [0.1, 0.5, 2.75, 4.8]) {
      await seek(clip.start + local);
      const sampledTime =
        Math.round((clip.start + local) * project.canvas.fps) /
        project.canvas.fps;
      const expected = glyphMotion(
        clip,
        sampledTime - clip.start,
        0,
        3,
        "text",
      );
      const glyph = page.locator(".behavior-text-layout > span").first();
      await expect
        .poll(async () =>
          Number(await glyph.evaluate((node) => node.style.opacity)),
        )
        .toBeCloseTo(expected.opacity, 6);
      await expect
        .poll(() =>
          glyph.evaluate((node) =>
            Number(node.style.transform.match(/rotateX\(([^d]+)deg\)/)[1]),
          ),
        )
        .toBeCloseTo(expected.rotationX, 3);
      expect(await glyph.evaluate((node) => node.style.transform)).not.toMatch(
        /NaN|Infinity/,
      );
      samples++;
    }
  }
  await seek(0.5);
  await page
    .locator(".canvas")
    .screenshot({ path: path.join(root, "float-preview.png") });
  const swayIndex = behaviorPresets.findIndex((preset) => preset.id === "sway");
  await page
    .locator(".timeline-clip.text")
    .nth(swayIndex)
    .locator(".clip-behavior-effect")
    .click();
  await page.getByRole("tab", { name: "期间", exact: true }).click();
  await expect(page.getByLabel("行为水平位移", { exact: true })).toHaveValue(
    "10.00",
  );
  await expect(page.getByLabel("行为垂直位移", { exact: true })).toHaveValue(
    "10.00",
  );
  await page.getByLabel("行为频率", { exact: true }).fill("2.50");
  for (const control of await page.locator(".behavior-number-control").all()) {
    const slider = await control.locator('input[type="range"]').boundingBox();
    const number = await control.locator('input[type="number"]').boundingBox();
    expect(number.width).toBeGreaterThan(40);
    expect(
      Math.abs(slider.y + slider.height / 2 - number.y - number.height / 2),
    ).toBeLessThan(2);
  }
  await page.getByTitle("保存项目 Ctrl+S", { exact: true }).click();
  await expect
    .poll(
      async () =>
        JSON.parse(await fs.readFile(file, "utf8")).clips[swayIndex]
          .behaviors[0].during.frequency,
    )
    .toBe(2.5);
  await page
    .locator(".inspector")
    .screenshot({ path: path.join(root, "sway-properties.png") });
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      root,
      presets: project.clips.length,
      samples,
      rendererErrors: errors,
    }),
  );
} catch (error) {
  await (
    await app.firstWindow()
  )
    .screenshot({ path: path.join(root, "failure.png") })
    .catch(() => { });
  console.error(root);
  throw error;
} finally {
  await app.close();
}
