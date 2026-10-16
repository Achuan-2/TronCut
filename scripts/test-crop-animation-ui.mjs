import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve("test-output/crop-animation-ui", `run-${Date.now()}`),
  profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
const image = path.join(root, "内容色块.png");
await sharp(
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><path fill="#b23244" d="M0 0H160V180H0Z"/><path fill="#35b778" d="M160 0H320V180H160Z"/><circle cx="230" cy="90" r="25" fill="#ffe483"/></svg>',
  ),
)
  .png()
  .toFile(image);
const project = {
  format: "troncut",
  version: 1,
  id: "crop-animation-ui",
  name: "固定范围缩放动画",
  canvas: { width: 1920, height: 1080, fps: 30, background: "#40328b" },
  tracks: [
    { id: "video", name: "轨道1", hidden: false, locked: false, muted: false },
  ],
  markers: [],
  assets: [
    {
      id: "image",
      name: "色块",
      path: image,
      kind: "image",
      duration: 8,
      width: 320,
      height: 180,
      hasAudio: false,
    },
  ],
  clips: [
    {
      id: "clip",
      assetId: "image",
      trackId: "video",
      kind: "image",
      name: "色块",
      start: 0,
      duration: 8,
      sourceIn: 0,
      speed: 1,
      volume: 1,
      podcast: false,
      transform: { x: 0.5, y: 0.5, scale: 0.55, opacity: 1 },
      keyframes: [],
    },
  ],
};
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
const packaged = process.env.FRAMECRAFT_PACKAGED_SMOKE === "1";
const app = await electron.launch({
  ...(packaged
    ? { executablePath: path.resolve(process.env.FRAMECRAFT_PACKAGED_APP) }
    : {}),
  args: packaged ? [] : ["."],
  env,
});
try {
  const page = await app.firstWindow(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "恢复编辑", exact: true }).click();
  await page.locator(".timeline-clip.image").click();
  await page.getByRole("button", { name: "裁剪模式", exact: true }).click();
  const layer = page.locator(".preview-panel .preview-layer.image"),
    zoom = page.getByLabel("缩放 (%)", { exact: true }),
    arrows = page.locator(".clip-animation");
  const seek = async (time) => {
    await page.locator(".ruler").click({ position: { x: time * 65, y: 15 } });
  };
  const fixed = await layer.boundingBox();
  const checkFixed = async () => {
    const box = await layer.boundingBox();
    for (const key of ["x", "y", "width", "height"])
      expect(box[key]).toBeCloseTo(fixed[key], 0);
  };
  await seek(2);
  await page.getByRole("button", { name: "自动动画", exact: true }).click();
  await zoom.fill("200");
  await expect(arrows).toHaveCount(1);
  await checkFixed();
  await expect(arrows.first()).toHaveAttribute("data-start", "1");
  await expect(arrows.first()).toHaveAttribute("data-end", "2");
  await seek(0.5);
  await expect(zoom).toHaveValue("100");
  await checkFixed();
  await seek(1.5);
  await expect(zoom).toHaveValue("150");
  await checkFixed();
  await page.getByRole("button", { name: "自动动画", exact: true }).click();
  await arrows.first().locator(".animation-point.end").click();
  const firstEnd = arrows.first().locator(".animation-point.end");
  await expect.poll(() => firstEnd.evaluate((element) => element.getAnimations().every((animation) => animation.playState !== "running"))).toBe(true);
  await zoom.fill("300");
  await expect.poll(() => firstEnd.evaluate((element) => element.getAnimations().some((animation) => animation.playState === "running"))).toBe(true);
  await expect(arrows).toHaveCount(1);
  await expect(arrows.first().locator(".animation-point.end")).toHaveClass(
    /selected-frame/,
  );
  // Endpoint pointer gestures retain focus; finish the number input's draft.
  await zoom.blur();
  await arrows.first().locator(".animation-point.start").click();
  await expect(zoom).toHaveValue("100");
  await zoom.fill("125");
  await zoom.blur();
  await expect(arrows).toHaveCount(1);
  await arrows.first().locator(".animation-point.end").click();
  await expect(zoom).toHaveValue("300");
  await page.mouse.move(fixed.x + fixed.width / 2, fixed.y + fixed.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    fixed.x + fixed.width / 2 + 18,
    fixed.y + fixed.height / 2,
    { steps: 4 },
  );
  await page.mouse.up();
  await checkFixed();
  await expect
    .poll(async () =>
      Number(
        await page.getByLabel("内容位置 X (%)", { exact: true }).inputValue(),
      ),
    )
    .toBeGreaterThan(0);
  await seek(0.5);
  await expect(zoom).toHaveValue("125");
  await expect(page.getByLabel("内容位置 X (%)", { exact: true })).toHaveValue(
    "0",
  );
  await seek(5);
  await page.getByRole("button", { name: "自动动画", exact: true }).click();
  await zoom.fill("200");
  await expect(arrows).toHaveCount(2);
  await checkFixed();
  await page.getByRole("button", { name: "自动动画", exact: true }).click();
  await arrows.nth(1).locator(".animation-point.start").click();
  const playhead = page.locator(".ruler-playhead");
  await expect(playhead).toHaveCSS("left", "260px");
  await expect(page.locator(".keyframe-edit-status")).toContainText(
    "编辑动画终点 · 00:02.00",
  );
  await expect(arrows.first().locator(".animation-point.end")).toHaveAttribute(
    "aria-pressed", "true",
  );
  await expect(zoom).toHaveValue("300");
  await page.getByRole("button", { name: "添加动画", exact: true }).click();
  await expect(arrows).toHaveCount(2);
  await expect(playhead).toHaveCSS("left", "260px");
  await zoom.fill("350");
  await expect(playhead).toHaveCSS("left", "260px");
  await expect(zoom).toHaveValue("350");
  await expect(arrows).toHaveCount(2);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(zoom).toHaveValue("300");
  await expect(playhead).toHaveCSS("left", "260px");
  await page.getByTitle("重做 Ctrl+Shift+Z", { exact: true }).click();
  await expect(zoom).toHaveValue("350");
  await expect(playhead).toHaveCSS("left", "260px");
  await seek(3);
  await expect(page.locator(".keyframe-edit-status")).toHaveCount(0);
  await expect(zoom).toHaveValue("350");
  await arrows.nth(1).locator(".animation-point.end").click();
  await expect(playhead).toHaveCSS("left", "325px");
  await expect(zoom).toHaveValue("200");
  await page.screenshot({ path: path.join(root, "fixed-range-animation.png") });
  const handle = layer.locator(".crop-handle.w");
  await handle.hover();
  const bounds = await handle.boundingBox();
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width / 2 + 20,
    bounds.y + bounds.height / 2,
    { steps: 4 },
  );
  await page.mouse.up();
  await expect(arrows).toHaveCount(2);
  const cropped = await layer.boundingBox();
  expect(cropped.width).toBeLessThan(fixed.width - 15);
  await arrows.nth(1).locator(".animation-point.start").click();
  await checkFixed();
  await arrows.nth(1).locator(".animation-point.end").click();
  expect((await layer.boundingBox()).width).toBeCloseTo(cropped.width, 0);
  await page.getByRole("button", { name: "恢复裁剪", exact: true }).click();
  await expect(zoom).toHaveValue("100");
  await checkFixed();
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(zoom).toHaveValue("200");
  expect((await layer.boundingBox()).width).toBeCloseTo(cropped.width, 0);
  await app.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [root],
    });
  }, root);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("工程已保存", {
    timeout: 20000,
  });
  const saved = JSON.parse(
    await fs.readFile(
      path.join(root, project.name, `${project.name}.troncut`),
      "utf8",
    ),
  );
  expect(
    saved.clips[0].keyframes.find((frame) => frame.time === 2).value
      .contentScale,
  ).toBe(3.5);
  expect(
    saved.clips[0].keyframes.find((frame) => frame.time === 5).value
      .contentScale,
  ).toBe(2);
  expect(
    saved.clips[0].keyframes.find((frame) => frame.time === 5).value.cropLeft,
  ).toBeGreaterThan(0);
  expect(
    saved.clips[0].keyframes.every((frame) => frame.value.scale === 0.55),
  ).toBe(true);
  await page.getByRole("button", { name: "返回首页", exact: true }).click();
  await page.locator(".recent-project").filter({ hasText: project.name }).click();
  await page.locator(".timeline-clip.image").click();
  await page.getByRole("button", { name: "裁剪模式", exact: true }).click();
  await seek(2); await expect(zoom).toHaveValue("350"); await checkFixed();
  await seek(5); await expect(zoom).toHaveValue("200");
  expect((await layer.boundingBox()).width).toBeCloseTo(cropped.width, 0);
  expect(errors).toEqual([]);
  console.log(
    `固定外框缩放动画、1秒独立箭头、中间帧、关闭自动后端点编辑、前一个终点编辑、平移、边缘裁剪动画、还原/撤销及保存通过：${root}`,
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
