import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(`test-output/visual-effect-range-ui-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
await fs.mkdir(path.join(root, "profile"), { recursive: true });
await fs.writeFile(path.join(root, "profile", "preferences.json"), JSON.stringify({
  storage: { projectDirectory: path.join(root, "Documents", "Projects") },
}));
await sharp({
  create: { width: 320, height: 180, channels: 3, background: "#00ff00" },
})
  .png()
  .toFile(path.join(root, "image.png"));
const bundled = await build({
  stdin: {
    contents:
      'export { createProject, newText, newTrack } from "./shared/model"; export { defaultVisualEffect } from "./shared/visual-effects"; export { animateMask } from "./shared/mask-animation";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { createProject, newText, newTrack, defaultVisualEffect, animateMask } =
  await import(
    `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
  );
const project = createProject("效果时间条");
project.canvas = { width: 320, height: 180, fps: 10, background: "#5432b2" };
project.tracks = [newTrack(0), { ...newTrack(1), locked: true }];
project.assets = [
  {
    id: "image",
    name: "绿色素材",
    path: "image.png",
    kind: "image",
    width: 320,
    height: 180,
    duration: 0,
    hasAudio: false,
  },
];
const original = animateMask(
  {
    ...newText(project.tracks[0].id, 0),
    id: "source",
    kind: "image",
    assetId: "image",
    duration: 4,
    transform: { x: 0.5, y: 0.5, scale: 0.8, opacity: 1 },
    mediaFrame: { radius: 100, unit: "percent", enabled: true },
    visualEffects: {
      mask: {
        ...defaultVisualEffect("mask"),
        shape: "rectangle",
        width: 0.5,
        height: 1,
        feather: 0,
      },
    },
  },
  { width: 0.6 },
  { time: 3, auto: true },
);
project.clips = [
  original,
  {
    ...newText(project.tracks[1].id, 0),
    id: "locked",
    kind: "image",
    assetId: "image",
    duration: 4,
    transform: { ...original.transform, opacity: 0 },
    visualEffects: { tint: defaultVisualEffect("tint") },
  },
];
const file = path.join(root, "project.troncut");
await fs.writeFile(file, JSON.stringify(project));
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: path.join(root, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
try {
  app = await electron.launch({ args: [".", file], env });
  let page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  const bar = (id) =>
    page
      .locator(
        `.clip-visual-effect-row[data-effect="${id}"] .clip-visual-effect`,
      )
      .first();
  const height = async (locator) =>
    Math.round((await locator.boundingBox()).height);
  const save = async () => {
    await page.getByTitle("保存项目 Ctrl+S", { exact: true }).click();
    await expect(page.locator(".project-save-state")).not.toContainText("*");
    return JSON.parse(await fs.readFile(file, "utf8"));
  };
  const range = async (id, start, end) => {
    await expect(bar(id)).toHaveAttribute("data-start", String(start));
    await expect(bar(id)).toHaveAttribute("data-end", String(end));
  };
  const drag = async (locator, delta, finish = true) => {
    await locator.scrollIntoViewIfNeeded();
    const bounds = await locator.boundingBox();
    const x = bounds.x + bounds.width / 2,
      y = bounds.y + bounds.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + delta * 65, y, { steps: 8 });
    if (finish) await page.mouse.up();
  };
  const seek = async (time) => {
    await page.locator(".ruler").click({ position: { x: time * 65, y: 28 } });
    await expect
      .poll(async () =>
        Number(await page.getByLabel("播放进度", { exact: true }).inputValue()),
      )
      .toBeCloseTo(time, 4);
  };
  const pixel = async (name, x, y) => {
    const png = await page
      .locator(".canvas")
      .screenshot({ path: path.join(root, `${name}.png`) });
    const { data, info } = await sharp(png)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const offset =
      (Math.floor(info.height * y) * info.width + Math.floor(info.width * x)) *
      3;
    return [...data.subarray(offset, offset + 3)];
  };
  await expect(page.locator(".clip-visual-effect-row")).toHaveCount(3);
  const lane = page.locator(".track-lane").first(),
    header = page.locator(".track-header").first();
  const expandedHeight = await height(lane);
  await expect.poll(() => height(header)).toBe(expandedHeight);
  await page
    .getByRole("button", { name: "收起片段效果", exact: true })
    .first()
    .click();
  await expect.poll(() => height(lane)).toBeLessThan(expandedHeight);
  await expect.poll(() => height(header)).toBe(await height(lane));
  await expect(bar("mask")).toHaveCount(0);
  await page
    .getByRole("button", { name: "展开片段效果", exact: true })
    .first()
    .click();
  await expect.poll(() => height(lane)).toBe(expandedHeight);
  await drag(bar("mask").locator('[data-edge="start"]'), 1);
  await range("mask", 1, 4);
  await expect(bar("mask")).toHaveClass(/selected/);
  await drag(bar("mask").locator('[data-edge="end"]'), -1);
  await range("mask", 1, 3);
  await drag(bar("mask"), -0.5);
  await range("mask", 0.5, 2.5);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await range("mask", 1, 3);
  await drag(bar("mask"), -0.5);
  await drag(bar("rounded-corners").locator('[data-edge="start"]'), 2.5);
  await drag(bar("rounded-corners").locator('[data-edge="end"]'), -0.5);
  await range("rounded-corners", 2.5, 3.5);
  // A canceled gesture must leave both the project and undo history unchanged.
  await drag(bar("mask").locator('[data-edge="start"]'), 0.3, false);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await range("mask", 0.5, 2.5);
  await drag(bar("mask").locator('[data-edge="end"]'), -0.3, false);
  await bar("mask").dispatchEvent("pointercancel");
  await page.mouse.up();
  await range("mask", 0.5, 2.5);
  await bar("mask").locator('[data-edge="end"]').focus();
  await page.keyboard.press("ArrowLeft");
  await range("mask", 0.5, 2.4);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await range("mask", 0.5, 2.5);
  await expect(bar("tint").locator('[data-edge="start"]')).toBeDisabled();
  await drag(bar("tint"), 0.5);
  await range("tint", 0, 4);
  let saved = await save();
  expect(saved.clips[0]).toMatchObject({
    start: original.start,
    duration: original.duration,
    transform: original.transform,
    keyframes: original.keyframes,
  });
  expect(saved.clips[0].visualEffects.mask.window).toEqual({
    start: 0.5,
    end: 2.5,
  });
  expect(saved.clips[0].mediaFrame.window).toEqual({ start: 2.5, end: 3.5 });
  for (const [time, x, y, hidden] of [
    [0.2, 0.2, 0.5, false],
    [1.5, 0.2, 0.5, true],
    [3, 0.12, 0.12, true],
    [3.8, 0.12, 0.12, false],
  ]) {
    await seek(time);
    const value = await pixel(`preview-${time}`, x, y);
    expect(value[hidden ? 2 : 1]).toBeGreaterThan(hidden ? 160 : 235);
  }
  // Adding another effect to a collapsed clip exposes the new row automatically.
  await page
    .getByRole("button", { name: "收起片段效果", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "视觉效果", exact: true }).click();
  await page.locator('.visual-effect-card[data-effect="border"]').dblclick();
  await expect(bar("border")).toBeVisible();
  await expect.poll(() => height(header)).toBeGreaterThan(expandedHeight);
  await expect.poll(() => height(header)).toBe(await height(lane));
  const contained = await lane
    .locator(".clip-visual-effect-row")
    .evaluateAll((nodes) =>
      nodes.every((node) => {
        const bounds = node.getBoundingClientRect(),
          clip = node.closest(".timeline-clip").getBoundingClientRect();
        return bounds.top >= clip.top && bounds.bottom <= clip.bottom;
      }),
    );
  expect(contained).toBe(true);
  saved = await save();
  expect(saved.clips[0].visualEffects.border).toBeTruthy();
  await page
    .locator(".timeline-body")
    .screenshot({ path: path.join(root, "effect-ranges.png") });
  await app.close();
  app = await electron.launch({ args: [".", file], env });
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.locator(".clip-visual-effect-row")).toHaveCount(4);
  await range("mask", 0.5, 2.5);
  await range("rounded-corners", 2.5, 3.5);
  await seek(1.5);
  expect((await pixel("reopened", 0.2, 0.5))[2]).toBeGreaterThan(160);
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      root,
      checks:
        "折叠展开、左右端拖动、整段移动、撤销、取消、逐帧键盘调节、锁定、画布像素、动画保留、新效果自动展开、行包含、保存重开",
      rendererErrors: errors,
    }),
  );
} catch (error) {
  if (app)
    await (
      await app.firstWindow()
    )
      .screenshot({ path: path.join(root, "failure.png") })
      .catch(() => { });
  console.error(root);
  throw error;
} finally {
  await app?.close();
}
