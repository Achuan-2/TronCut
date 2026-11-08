import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(`test-output/timeline-height/run-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const bundle = await build({
  stdin: {
    contents:
      'export { createProject, newText, newTrack } from "./shared/model";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { createProject, newText, newTrack } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const project = createProject("时间轴整体高度");
while (project.tracks.length < 16)
  project.tracks.push(newTrack(project.tracks.length));
project.tracks.forEach((track) => {
  track.height = 60;
});
project.clips = project.tracks.map((track) => newText(track.id, 0));
const file = path.join(root, "fixture.troncut");
const original = JSON.stringify(project);
await fs.writeFile(file, original);
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: path.join(root, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
let page;
const errors = [];
const launch = async () => {
  app = await electron.launch({ args: [".", file], env });
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1500, 1000),
  );
  await expect(
    page.getByRole("separator", { name: "调整时间轴整体高度" }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => innerHeight))
    .toBeGreaterThan(990);
};
const divider = () =>
  page.getByRole("separator", { name: "调整时间轴整体高度" });
const height = () =>
  page
    .locator(".timeline")
    .evaluate((node) => node.getBoundingClientRect().height);
const workspaceHeight = () =>
  page
    .locator(".editor-workspace")
    .evaluate((node) => node.getBoundingClientRect().height);
async function drag(delta, finish = "commit") {
  const before = await height();
  const box = await divider().boundingBox();
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x, point.y - delta, { steps: 8 });
  await expect.poll(height).toBeCloseTo(before + delta, 0);
  if (finish === "escape") await page.keyboard.press("Escape");
  if (finish === "cancel")
    await divider().dispatchEvent("pointercancel", { pointerId: 1 });
  await page.mouse.up();
  await expect
    .poll(height)
    .toBeCloseTo(finish === "commit" ? before + delta : before, 0);
}
try {
  await launch();
  const initial = await height();
  const workspace = await workspaceHeight();
  const trackHeight = await page
    .locator(".track-lane")
    .first()
    .evaluate((node) => node.getBoundingClientRect().height);
  await drag(120);
  await expect.poll(workspaceHeight).toBeCloseTo(workspace - 120, 0);
  await drag(-50);
  const saved = await height();
  await drag(30, "escape");
  await drag(30, "cancel");
  expect(
    await page
      .locator(".track-lane")
      .first()
      .evaluate((node) => node.getBoundingClientRect().height),
  ).toBe(trackHeight);

  await page.locator(".timeline-scroll").evaluate((node) => {
    node.scrollTop = 180;
    node.dispatchEvent(new Event("scroll"));
  });
  await expect
    .poll(async () =>
      page.evaluate(() =>
        Math.abs(
          document.querySelector(".track-headers").scrollTop -
            document.querySelector(".timeline-scroll").scrollTop,
        ),
      ),
    )
    .toBeLessThan(1);
  await page.screenshot({ path: path.join(root, "resized.png") });
  await app.close();
  await launch();
  await expect.poll(height).toBeCloseTo(saved, 0);
  await divider().focus();
  await page.keyboard.press("End");
  const maximum = await height();
  expect(await workspaceHeight()).toBeGreaterThanOrEqual(280);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1500, 720),
  );
  await expect.poll(height).toBeLessThan(maximum);
  expect(await workspaceHeight()).toBeGreaterThanOrEqual(280);
  expect(
    await page
      .locator(".timeline")
      .evaluate((node) => node.getBoundingClientRect().bottom - innerHeight),
  ).toBeLessThan(1);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1500, 1000),
  );
  await expect.poll(height).toBeCloseTo(maximum, 0);
  await divider().focus();
  await page.keyboard.press("Home");
  await expect.poll(height).toBe(180);
  await page.keyboard.press("ArrowUp");
  await expect.poll(height).toBe(190);
  await divider().dblclick();
  await expect.poll(height).toBeCloseTo(initial, 0);
  expect(
    await page.evaluate(() => localStorage.getItem("troncut.timeline-height")),
  ).toBeNull();
  expect(await fs.readFile(file, "utf8")).toBe(original);
  expect(errors).toEqual([]);
  console.log(
    `整体高度拖动、预览空间、轨道高度保持、滚动同步、取消、键盘、窗口约束、重启记忆及双击重置通过：${root}`,
  );
} catch (error) {
  console.error(
    await page?.evaluate(() => ({
      viewport: innerHeight,
      shell: document
        .querySelector(".app-shell")
        ?.getBoundingClientRect()
        .toJSON(),
      layout: document
        .querySelector(".editor-layout")
        ?.getBoundingClientRect()
        .toJSON(),
      timeline: document
        .querySelector(".timeline")
        ?.getBoundingClientRect()
        .toJSON(),
    })),
  );
  await page
    ?.screenshot({ path: path.join(root, "failure.png") })
    .catch(() => {});
  console.error(root);
  throw error;
} finally {
  await app?.close();
}
