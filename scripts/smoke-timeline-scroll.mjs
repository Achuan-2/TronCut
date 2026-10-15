import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(`test-output/timeline-scroll/run-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const bundled = await build({
  stdin: {
    contents:
      'export { createProject, newTrack, newText } from "./shared/model"; export { createBehavior } from "./shared/behaviors";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { createProject, newTrack, newText, createBehavior } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const project = createProject("滚动同步测试");
project.tracks = Array.from({ length: 10 }, (_, index) => newTrack(index));
project.clips = project.tracks.map((track, index) => ({
  ...newText(track.id, 0, 0, `轨道素材 ${index + 1}`),
  duration: 30,
  ...(index % 2 === 0 || index === 9
    ? { behaviors: [createBehavior("fade", 30)] }
    : {}),
}));
const file = path.join(root, "fixture.troncut");
await fs.writeFile(file, JSON.stringify(project));
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: path.join(root, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["."], env });
const errors = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, file);
  await page.getByRole("button", { name: "打开项目", exact: true }).click();
  await expect(page.locator(".track-lane")).toHaveCount(10);
  const metrics = () =>
    page.evaluate(() => {
      const left = document.querySelector(".track-headers");
      const right = document.querySelector(".timeline-scroll");
      const headers = [...document.querySelectorAll(".track-header")];
      const lanes = [...document.querySelectorAll(".track-lane")];
      return {
        leftTop: left.scrollTop,
        rightTop: right.scrollTop,
        leftMax: left.scrollHeight - left.clientHeight,
        rightMax: right.scrollHeight - right.clientHeight,
        horizontal: right.scrollLeft,
        alignment: headers.map((header, i) =>
          Math.abs(
            header.getBoundingClientRect().top -
              lanes[i].getBoundingClientRect().top,
          ),
        ),
        rulerTop: document.querySelector(".ruler").getBoundingClientRect().top,
        labelTop: document.querySelector(".ruler-label").getBoundingClientRect()
          .top,
      };
    });
  const checkAligned = async () => {
    await expect
      .poll(async () => {
        const value = await metrics();
        return Math.max(
          Math.abs(value.leftTop - value.rightTop),
          ...value.alignment,
        );
      })
      .toBeLessThanOrEqual(1);
  };
  const initial = await metrics();
  assert.ok(initial.rightMax > 100);
  // Both panes must be able to reach exactly the same final row offset, even
  // when the clip pane reserves space for its horizontal scrollbar.
  await expect
    .poll(async () => {
      const value = await metrics();
      return Math.abs(value.leftMax - value.rightMax);
    })
    .toBeLessThanOrEqual(1);
  await page.locator(".timeline-scroll").evaluate((element) => {
    element.scrollTop = 170;
    element.scrollLeft = 140;
  });
  await checkAligned();
  await page.locator(".timeline-scroll").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await checkAligned();
  const bottom = await metrics();
  assert.ok(Math.abs(bottom.rightTop - bottom.rightMax) <= 1);
  assert.equal(bottom.rulerTop, initial.rulerTop);
  assert.equal(bottom.labelTop, initial.labelTop);
  await page.screenshot({ path: path.join(root, "bottom.png") });
  const lastEffect = page
    .locator(".track-lane")
    .last()
    .locator(".clip-effects-toggle");
  await lastEffect.click();
  await checkAligned();
  await lastEffect.click();
  await checkAligned();

  // A wheel gesture over either pane must move both panes, retaining horizontal position.
  const left = await page.locator(".track-headers").boundingBox();
  await page.mouse.move(left.x + left.width / 2, left.y + left.height / 2);
  await page.mouse.wheel(0, -180);
  await expect
    .poll(async () => (await metrics()).leftTop)
    .toBeLessThan(bottom.leftTop - 50);
  await checkAligned();
  assert.equal((await metrics()).horizontal, 140);
  const middle = await metrics();
  const right = await page.locator(".timeline-scroll").boundingBox();
  await page.mouse.move(right.x + 200, right.y + right.height / 2);
  await page.mouse.wheel(0, 130);
  await expect
    .poll(async () => (await metrics()).rightTop)
    .toBeGreaterThan(middle.rightTop + 30);
  await checkAligned();
  // Fit the horizontal content, then restore horizontal overflow and resize the window.
  await page.getByLabel("时间线缩放").fill("15");
  await checkAligned();
  await page.getByLabel("时间线缩放").fill("100");
  await checkAligned();
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(1280, 760);
  });
  await page.locator(".timeline-scroll").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await checkAligned();
  // Selecting an off-screen clip also uses the shared vertical position.
  await page.locator(".timeline-clip").first().click();
  await checkAligned();
  await expect.poll(async () => (await metrics()).rightTop).toBe(0);
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(root, "result.json"),
    JSON.stringify(
      { initial, bottom, final: await metrics(), errors },
      null,
      2,
    ),
  );
  console.log(`左右滚动、底部对齐、横向缩放、窗口缩放及选中定位通过：${root}`);
} finally {
  await app.close();
}
