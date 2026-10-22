import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimelineZoom, timelineZoom } from "./timeline-zoom.mjs";

const root = path.resolve(
  "test-output/animation-endpoints-ui",
  `run-${Date.now()}`,
);
await fs.mkdir(root, { recursive: true });
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
const project = createProject("相邻动画端点对齐");
const clip = { ...newText("titles", 0), duration: 30 };
clip.keyframes = [
  [0, 0.2],
  [1, 0.4],
  [2, 0.6],
  [3, 0.6],
  [4, 0.4],
  [4.1, 0.4],
  [5, 0.5],
].map(([time, x]) => ({ time, value: { ...clip.transform, x } }));
project.clips = [clip];
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
  await page.locator(".timeline-clip").first().click();
  const arrows = page.locator(".clip-animation");
  await expect(arrows).toHaveCount(4);
  const offsets = () =>
    arrows.evaluateAll((arrows) =>
      arrows.flatMap((arrow) => {
        const bounds = arrow.getBoundingClientRect();
        return ["start", "end"].map((side) => {
          const button = arrow.querySelector(`.animation-point.${side}`);
          const dot = button.querySelector(".animation-point-dot") ?? button;
          const rect = dot.getBoundingClientRect();
          return (
            rect.x +
            rect.width / 2 -
            (side === "start" ? bounds.left : bounds.right)
          );
        });
      }),
    );
  const aligned = async () => {
    for (const offset of await offsets())
      expect(Math.abs(offset)).toBeLessThan(0.1);
  };
  for (const zoom of [65, 120]) {
    await setTimelineZoom(page, zoom);
    await aligned();
    await arrows
      .first()
      .screenshot({ path: path.join(root, `first-arrow-${zoom}.png`) });
  }
  await setTimelineZoom(page, 65);
  // Context menus target the animation without moving the preview clock.
  const progress = page.getByLabel("播放进度", { exact: true });
  const menu = page.getByRole("menu", { name: "动画菜单", exact: true });
  const first = arrows.first();
  await progress.fill("8.5");
  for (const target of [
    first.locator(".animation-arrow"),
    first.locator(".animation-point.start"),
    first.locator(".animation-point.end"),
  ]) {
    await target.click({ button: "right" });
    await expect(menu).toBeVisible();
    await expect(progress).toHaveValue("8.5");
    await expect(first).toHaveClass(/selected-animation/);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(progress).toHaveValue("8.5");
  }
  await first.locator(".animation-arrow").click({ button: "right" });
  await menu.getByRole("menuitem", { name: /^复制/ }).click();
  await expect(progress).toHaveValue("8.5");
  await first.locator(".animation-arrow").click({ button: "right" });
  await menu.getByRole("menuitem", { name: "启用缓冲" }).hover();
  await page.getByRole("menuitemradio", { name: "线性", exact: true }).click();
  await expect(progress).toHaveValue("8.5");
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(progress).toHaveValue("8.5");
  // A normal left click still locates the corresponding endpoint.
  await first.locator(".animation-arrow").click();
  await expect(progress).toHaveValue("1");
  const end = arrows.nth(0).locator(".animation-point.end");
  const start = arrows.nth(1).locator(".animation-point.start");
  // Coincident endpoints keep distinct left/right hit targets at the same time.
  for (const point of [end, start]) {
    const box = await point.boundingBox();
    expect(
      await point.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return node.contains(
          document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          ),
        );
      }),
    ).toBe(true);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    // A later animation's start edits the preceding end, preserving the hold.
    await expect(end).toHaveAttribute("aria-pressed", "true");
    await aligned();
    const animatedOffsets = await page.evaluate(async () => {
      const values = [];
      for (let i = 0; i < 24; i++) {
        await new Promise(requestAnimationFrame);
        for (const point of document.querySelectorAll(".animation-point")) {
          const dot = point.querySelector(".animation-point-dot") ?? point;
          const rect = dot.getBoundingClientRect();
          const arrow = point
            .closest(".clip-animation")
            .getBoundingClientRect();
          values.push(
            rect.x +
              rect.width / 2 -
              (point.classList.contains("start") ? arrow.left : arrow.right),
          );
        }
      }
      return values;
    });
    for (const offset of animatedOffsets)
      expect(Math.abs(offset)).toBeLessThan(0.1);
  }
  await page
    .locator(".timeline")
    .screenshot({ path: path.join(root, "adjacent-selected.png") });
  const box = await end.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 - 0.2 * (await timelineZoom(page)),
    box.y + box.height / 2,
    { steps: 6 },
  );
  await page.mouse.up();
  await expect(arrows.first()).toHaveAttribute("data-end", "0.8");
  await aligned();
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(arrows.first()).toHaveAttribute("data-end", "1");
  await aligned();
  expect(errors).toEqual([]);
  console.log(
    `动画箭头/端点右键及菜单操作保持播放头、左键定位、相邻端点对齐、两档缩放、选中脉冲、拖动及撤销通过：${root}`,
  );
} catch (error) {
  await (
    await app.firstWindow()
  )
    .screenshot({ path: path.join(root, "failure.png") })
    .catch(() => {});
  throw error;
} finally {
  await app.close();
}
