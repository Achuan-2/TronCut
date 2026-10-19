import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve("test-output/playhead-range-ui", `run-${Date.now()}`);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
const bundle = await build({
  stdin: {
    contents: 'export { createProject, newText } from "./shared/model";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { createProject, newText } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const project = createProject("播放头边界定位");
project.clips = [{ ...newText("titles", 0), duration: 60 }];
await fs.writeFile(
  path.join(profile, "recovery.json"),
  JSON.stringify({ project, file: null }),
);
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["."], env });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "恢复编辑", exact: true }).click();
  const start = page.getByRole("slider", { name: "范围起点", exact: true });
  const end = page.getByRole("slider", { name: "范围终点", exact: true });
  const head = page.getByRole("button", { name: "播放头", exact: true });
  const scroll = page.locator(".timeline-scroll");
  const progress = page.getByLabel("播放进度", { exact: true });
  const checkCollapsed = async () => {
    const a = await start.boundingBox(),
      b = await head.boundingBox(),
      c = await end.boundingBox();
    expect(a.x + a.width).toBeCloseTo(b.x, 1);
    expect(c.x).toBeCloseTo(b.x + b.width, 1);
  };
  await progress.fill("59");
  await scroll.evaluate((node) => {
    node.scrollLeft = 60 * 65 - node.clientWidth + 24;
  });
  await checkCollapsed();
  await page.getByTitle("播放 / 暂停（空格）", { exact: true }).click();
  // Sample actual rendered frames while playback approaches the right edge.
  const samples = await page.evaluate(async () => {
    const snapshots = [];
    for (let i = 0; i < 100; i++) {
      await new Promise(requestAnimationFrame);
      const a = document.querySelector(".timeline-range-handle.start").getBoundingClientRect();
      const b = document.querySelector(".timeline-playhead-handle").getBoundingClientRect();
      const c = document.querySelector(".timeline-range-handle.end").getBoundingClientRect();
      snapshots.push([a.right - b.left, c.left - b.right]);
    }
    return snapshots;
  });
  for (const [left, right] of samples) {
    expect(Math.abs(left)).toBeLessThan(0.1);
    expect(Math.abs(right)).toBeLessThan(0.1);
  }
  await expect(progress).toHaveValue("60");
  await checkCollapsed();
  await page.locator(".timeline").screenshot({
    path: path.join(root, "playback-right-edge.png"),
  });

  // Drag out the left endpoint, then seek between the stationary range ends.
  const startBox = await start.boundingBox();
  await page.mouse.move(startBox.x + 6, startBox.y + 5);
  await page.mouse.down();
  await page.mouse.move(startBox.x + 6 - 130, startBox.y + 5, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(start).toHaveAttribute("aria-valuenow", "58");
  await expect(end).toHaveAttribute("aria-valuenow", "60");
  await progress.fill("59");
  const rulerBox = await page.locator(".ruler").boundingBox();
  expect((await start.boundingBox()).x + 12).toBeCloseTo(
    rulerBox.x + 58 * 65, 1,
  );
  expect((await end.boundingBox()).x).toBeCloseTo(
    rulerBox.x + 60 * 65, 1,
  );
  await head.dblclick();
  await checkCollapsed();

  // End and Home remain keyboard accessible at the full timeline boundaries.
  await end.focus();
  await page.keyboard.press("End");
  await head.dblclick();
  await scroll.evaluate((node) => {
    node.scrollLeft = node.scrollWidth;
  });
  await checkCollapsed();
  await page.locator(".timeline").screenshot({
    path: path.join(root, "right-edge.png"),
  });
  await start.focus();
  await page.keyboard.press("Home");
  await head.dblclick();
  await expect(start).toBeInViewport();
  await expect(end).toBeInViewport();
  await expect(start).toHaveAttribute("aria-valuenow", "0");
  await expect(end).toHaveAttribute("aria-valuenow", "0");
  expect(errors).toEqual([]);
  console.log(
    `右侧播放逐帧对齐、范围拖动与独立定位、End/Home 边界及双击收起通过：${root}`,
  );
} catch (error) {
  await (await app.firstWindow())
    .screenshot({ path: path.join(root, "failure.png") })
    .catch(() => {});
  throw error;
} finally {
  await app.close();
}
