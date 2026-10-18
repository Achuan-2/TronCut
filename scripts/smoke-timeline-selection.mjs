import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(`test-output/timeline-selection/run-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const bundled = await build({
  stdin: {
    contents:
      'export { createProject, newTrack, newText } from "./shared/model"; export { appendCaptionCues } from "./shared/captions";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { createProject, newTrack, newText, appendCaptionCues } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const project = createProject("时间线取消选中测试");
project.tracks = [newTrack(0), newTrack(1)];
project.clips = project.tracks.map((track, index) => ({
  ...newText(track.id, 1, 0, `素材 ${index + 1}`),
  duration: 2,
}));
const fixture = appendCaptionCues(project, [
  { start: 1, end: 2, text: "字幕甲" },
  { start: 2, end: 3, text: "字幕乙" },
]);
for (const track of fixture.project.tracks) track.height = 50;
const file = path.join(root, "fixture.troncut");
await fs.writeFile(file, JSON.stringify(fixture.project));
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: path.join(root, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [".", file], env });
const errors = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  const clips = page.locator(".timeline-clip:not(.caption)");
  const selected = page.locator(".timeline-clip.selected");
  await expect(clips).toHaveCount(2);
  await page.getByLabel("时间线缩放").fill("80");
  await page.locator(".timeline-scroll").evaluate((element) => {
    element.scrollLeft = 0;
  });
  await expect
    .poll(() =>
      page
        .locator(".timeline-scroll")
        .evaluate((element) => element.scrollLeft),
    )
    .toBe(0);
  const lane = page.locator(
    `.track-lane[data-track="${project.tracks[0].id}"]`,
  );
  let bounds;

  // A click beside a selected clip must clear it and still seek the playhead.
  await clips.first().click();
  await expect(selected).toHaveCount(1);
  bounds = await lane.boundingBox();
  await page.mouse.click(bounds.x + 320, bounds.y + 20);
  await expect(selected).toHaveCount(0);
  await expect
    .poll(() =>
      page
        .locator(".playhead")
        .evaluate(
          (element) => new DOMMatrix(getComputedStyle(element).transform).m41,
        ),
    )
    .toBeGreaterThan(100);

  // Small pointer jitter remains a click, and clicking an empty lane clears a multiselection.
  await clips.first().click();
  await clips.nth(1).click({ modifiers: ["Control"] });
  await expect(selected).toHaveCount(2);
  bounds = await lane.boundingBox();
  await page.mouse.move(bounds.x + 320, bounds.y + 20);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 322, bounds.y + 21);
  await page.mouse.up();
  await expect(selected).toHaveCount(0);

  // Marquee capture still selects clips without the release click clearing them.
  bounds = await lane.boundingBox();
  const otherBounds = await page
    .locator(`.track-lane[data-track="${project.tracks[1].id}"]`)
    .boundingBox();
  await page.mouse.move(bounds.x + 40, bounds.y + 4);
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + 270,
    otherBounds.y + otherBounds.height - 4,
    { steps: 15 },
  );
  await page.mouse.up();
  await expect(selected).toHaveCount(2);
  await expect(page.locator(".timeline-marquee")).toHaveCount(0);

  // The unused viewport below all tracks is also a deselection target.
  await expect
    .poll(() =>
      page
        .locator(".timeline-scroll")
        .evaluate(
          (element) =>
            element.clientHeight -
            element.querySelector(".timeline-content").clientHeight,
        ),
    )
    .toBeGreaterThan(10);
  const viewport = await page.locator(".timeline-scroll").boundingBox();
  await page.mouse.click(viewport.x + 320, viewport.y + viewport.height - 15);
  await expect(selected).toHaveCount(0);

  // Caption lane clicks retain their existing whole-track selection behavior.
  const captions = page.locator(".timeline-clip.caption");
  await captions.first().click();
  await expect(selected).toHaveCount(2);
  const captionLane = await captions.first().locator("..").boundingBox();
  await page.mouse.click(captionLane.x + 320, captionLane.y + 20);
  await expect(selected).toHaveCount(2);
  bounds = await lane.boundingBox();
  await page.mouse.click(bounds.x + 320, bounds.y + 20);
  await expect(selected).toHaveCount(0);

  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(root, "deselected.png") });
  console.log(`空白取消选中、轻微移动、多选、框选及字幕轨道交互通过：${root}`);
} catch (error) {
  const page = await app.firstWindow();
  await page.screenshot({ path: path.join(root, "failure.png") });
  console.log(
    await page.locator(".timeline-clip").evaluateAll((elements) =>
      elements.map((element) => ({
        className: element.className,
        text: element.textContent,
        bounds: element.getBoundingClientRect().toJSON(),
      })),
    ),
  );
  console.log(root);
  throw error;
} finally {
  await app.close();
}
