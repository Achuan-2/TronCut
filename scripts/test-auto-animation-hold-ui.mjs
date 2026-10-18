import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(
  "test-output/auto-animation-hold-ui",
  `run-${Date.now()}`,
);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
const image = path.join(root, "object.png");
await sharp({
  create: { width: 180, height: 320, channels: 4, background: "#35b778" },
})
  .png()
  .toFile(image);
const transform = { x: 0.5, y: 0.5, scale: 0.45, opacity: 1 };
const project = {
  format: "troncut",
  version: 1,
  id: "auto-hold",
  name: "自动动画静止帧回归",
  canvas: { width: 1920, height: 1080, fps: 30, background: "#101820" },
  tracks: [
    { id: "video", name: "轨道1", hidden: false, locked: false, muted: false },
  ],
  markers: [],
  assets: [
    {
      id: "image",
      name: "object",
      path: image,
      kind: "image",
      duration: 5,
      width: 180,
      height: 320,
      hasAudio: false,
    },
  ],
  clips: [
    {
      id: "clip",
      assetId: "image",
      trackId: "video",
      kind: "image",
      name: "object",
      start: 0,
      duration: 5,
      sourceIn: 0,
      speed: 1,
      volume: 1,
      podcast: false,
      transform,
      // Static edits can leave identical keyframes, invisible as animation arrows.
      keyframes: [0, 1.2, 2.2, 2.3, 2.9, 3.9].map((time) => ({
        time,
        value: transform,
      })),
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
const app = await electron.launch({ args: ["."], env });
const page = await app.firstWindow();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.getByRole("button", { name: "恢复编辑", exact: true }).click();
  await page.locator(".timeline-clip.image").click();
  const layer = page.locator(".preview-panel .preview-layer.image");
  const arrows = page.locator(".clip-animation");
  const seek = (time) =>
    page.locator(".ruler").click({ position: { x: time * 65, y: 15 } });
  const center = async () => {
    const box = await layer.boundingBox();
    return box.x + box.width / 2;
  };
  await expect(arrows).toHaveCount(0);
  await seek(2.6);
  await page.getByRole("button", { name: "自动动画", exact: true }).click();
  await layer.click();
  await expect(layer).toHaveClass(/selected/);
  const original = await center();
  const box = await layer.boundingBox();
  await page.mouse.move(original, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(original + 100, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(center).toBeCloseTo(original + 100, 0);
  const moved = await center();
  await expect(arrows).toHaveCount(1);
  await expect(arrows).toHaveAttribute("data-start", "1.6");
  await expect(arrows).toHaveAttribute("data-end", "2.6");
  await seek(2.1);
  await expect.poll(center).toBeCloseTo((original + moved) / 2, 0);
  for (const time of [2.75, 2.9, 3.5, 4.5]) {
    await seek(time);
    await expect.poll(center).toBeCloseTo(moved, 0);
  }
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(arrows).toHaveCount(0);
  await expect.poll(center).toBeCloseTo(original, 0);
  await page.getByTitle("重做 Ctrl+Shift+Z", { exact: true }).click();
  await expect(arrows).toHaveCount(1);
  await expect.poll(center).toBeCloseTo(moved, 0);
  await seek(2.75);
  await page.keyboard.press("Space");
  await expect
    .poll(
      async () =>
        page
          .locator(".playhead")
          .evaluate(
            (element) =>
              new DOMMatrixReadOnly(getComputedStyle(element).transform).m41 /
              65,
          ),
      {
        timeout: 5000,
      },
    )
    .toBeGreaterThan(4);
  await page.keyboard.press("Space");
  await expect.poll(center).toBeCloseTo(moved, 0);
  await app.evaluate(
    ({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath,
      });
    },
    path.join(root, `${project.name}.troncut`),
  );
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
  const frames = saved.clips[0].keyframes;
  expect(frames.map((frame) => frame.time)).toEqual([1.6, 2.6]);
  const endpoint = frames.find((frame) => Math.abs(frame.time - 2.6) < 0.001);
  expect(endpoint.value.x).toBeGreaterThan(0.5);
  expect(
    frames
      .filter((frame) => frame.time > 2.6)
      .every((frame) => frame.value.x === endpoint.value.x),
  ).toBe(true);
  await page.getByRole("button", { name: "返回首页", exact: true }).click();
  await page
    .locator(".recent-project")
    .filter({ hasText: project.name })
    .click();
  await page.locator(".timeline-clip.image").click();
  await seek(4.5);
  await expect(arrows).toHaveCount(1);
  await expect.poll(center).toBeCloseTo(moved, 0);
  await page.screenshot({ path: path.join(root, "held-position.png") });
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      root,
      checks:
        "单次拖动仅一段动画、插值、后续位置保持、撤销重做、实际播放、保存重开",
      rendererErrors: errors,
    }),
  );
} catch (error) {
  await page
    .screenshot({ path: path.join(root, "failure.png") })
    .catch(() => {});
  console.error(root);
  throw error;
} finally {
  await app.close();
}
