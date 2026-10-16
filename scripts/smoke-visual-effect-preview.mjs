import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(`test-output/visual-effect-preview-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
await sharp({
  create: { width: 320, height: 180, channels: 3, background: "#66d99a" },
})
  .png()
  .toFile(path.join(root, "image.png"));
const bundled = await build({
  stdin: {
    contents:
      'export { createProject, newText } from "./shared/model"; export { visualEffectPresets } from "./shared/preset-library";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { createProject, newText, visualEffectPresets } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const project = createProject("视觉效果悬停预览");
project.assets = [
  {
    id: "image",
    name: "图片",
    path: "image.png",
    kind: "image",
    width: 320,
    height: 180,
    duration: 0,
    hasAudio: false,
  },
];
project.canvas = { width: 320, height: 180, fps: 30, background: "#142821" };
project.clips = [
  {
    ...newText("video", 0),
    id: "source",
    kind: "image",
    assetId: "image",
    duration: 4,
  },
];
const file = path.join(root, "project.troncut");
const original = JSON.stringify(project);
await fs.writeFile(file, original);
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
  await page.getByRole("button", { name: "视觉效果", exact: true }).click();
  const card = (id) => page.locator(`.visual-effect-card[data-effect="${id}"]`);
  const animations = (locator) =>
    locator.evaluate((node) => node.getAnimations({ subtree: true }).length);
  await expect(page.locator(".visual-effect-card")).toHaveCount(9);
  expect(await animations(page.locator(".visual-effects-grid"))).toBe(0);
  const changes = {};
  for (const { id } of visualEffectPresets) {
    const tile = card(id),
      preview = tile.locator(".effect-card-preview");
    await tile.hover();
    await expect(preview).toHaveAttribute("data-previewing", "true");
    await expect.poll(() => animations(preview)).toBeGreaterThan(0);
    // Sample two specific frames instead of relying on wall-clock timing.
    const frame = async (time) => {
      await preview.evaluate((node, time) => {
        for (const animation of node.getAnimations({ subtree: true })) {
          animation.currentTime = time;
        }
      }, time);
      return sharp(
        await preview.screenshot({
          path: path.join(root, `${id}-${time}.png`),
        }),
      )
        .ensureAlpha()
        .raw()
        .toBuffer();
    };
    const before = await frame(100),
      after = await frame(1500);
    let changed = 0;
    for (let i = 0; i < before.length; i += 4)
      if (
        [0, 1, 2].some(
          (channel) => Math.abs(before[i + channel] - after[i + channel]) > 15,
        )
      )
        changed++;
    changes[id] = changed;
    expect(
      changed,
      `${id} should demonstrate a visible effect`,
    ).toBeGreaterThan(20);
    await page.mouse.move(5, 5);
    await expect(preview).toHaveAttribute("data-previewing", "false");
    await expect.poll(() => animations(preview)).toBe(0);
  }
  expect(await fs.readFile(file, "utf8")).toBe(original);
  await expect(page.locator(".project-save-state")).not.toContainText("*");
  // Keyboard focus previews the same card, and blur releases its animations.
  await page.getByLabel("搜索视觉效果", { exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(card("rounded-corners")).toBeFocused();
  await expect(
    card("rounded-corners").locator(".effect-card-preview"),
  ).toHaveAttribute("data-previewing", "true");
  await page.getByLabel("搜索视觉效果", { exact: true }).focus();
  await expect.poll(() => animations(card("rounded-corners"))).toBe(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await card("shadow").hover();
  await expect.poll(() => animations(card("shadow"))).toBe(0);
  await page.mouse.move(5, 5);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  // Filtering unmounts the old demo and must not leave animations behind.
  await card("mask").hover();
  await page.getByLabel("搜索视觉效果", { exact: true }).fill("阴影");
  await expect(page.locator(".visual-effect-card")).toHaveCount(1);
  await expect
    .poll(() => animations(page.locator(".visual-effects-grid")))
    .toBe(0);
  await page.getByLabel("清除视觉效果搜索", { exact: true }).click();
  await page.getByRole("button", { name: "收藏：阴影", exact: true }).click();
  await page.getByRole("button", { name: "收藏夹", exact: true }).click();
  await expect(page.locator(".visual-effect-card")).toHaveCount(1);
  await card("shadow").hover();
  await expect.poll(() => animations(card("shadow"))).toBeGreaterThan(0);
  await page.getByRole("button", { name: "视觉效果", exact: true }).click();
  const source = page.locator('.canvas .preview-layer[data-clip-id="source"]');
  await card("mask").dragTo(source);
  await expect(
    page.getByRole("region", { name: "遮罩属性", exact: true }),
  ).toBeVisible();
  await expect.poll(() => animations(card("mask"))).toBe(0);
  await card("border").dblclick();
  await expect(
    page.getByRole("region", { name: "边框属性", exact: true }),
  ).toBeVisible();
  await page.getByTitle("保存工程 Ctrl+S", { exact: true }).click();
  await expect(page.locator(".busy-overlay")).toHaveCount(0);
  await expect(page.locator(".project-save-state")).not.toContainText("*");
  const saved = JSON.parse(await fs.readFile(file, "utf8"));
  expect(saved.clips[0].visualEffects.mask.enabled).toBe(true);
  expect(saved.clips[0].visualEffects.border.enabled).toBe(true);
  await page.mouse.move(5, 5);
  await page
    .locator(".visual-effects-panel")
    .screenshot({ path: path.join(root, "effect-library.png") });
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      root,
      changes,
      checks:
        "九种效果逐帧像素、离开停止、键盘聚焦、减少动态效果、搜索卸载、收藏夹、拖放与双击应用、工程隔离",
      rendererErrors: errors,
    }),
  );
} catch (error) {
  await (
    await app.firstWindow()
  )
    .screenshot({ path: path.join(root, "failure.png") })
    .catch(() => {});
  console.error(root);
  throw error;
} finally {
  await app.close();
}
