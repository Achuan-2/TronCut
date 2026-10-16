import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(`test-output/frame-dimensions-ui-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
await sharp({
  create: { width: 200, height: 100, channels: 3, background: "#66d99a" },
})
  .png()
  .toFile(path.join(root, "image.png"));
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
const project = createProject("宽高比例锁定");
project.canvas = { width: 400, height: 200, fps: 30, background: "#5432b2" };
project.assets = [
  {
    id: "image",
    name: "图片",
    path: "image.png",
    kind: "image",
    width: 200,
    height: 100,
    duration: 0,
    hasAudio: false,
  },
];
project.clips = [
  {
    ...newText("video", 0),
    kind: "image",
    assetId: "image",
    transform: { x: 0.5, y: 0.5, scale: 0.5, opacity: 1 },
  },
];
const file = path.join(root, "dimensions.troncut");
await fs.writeFile(file, JSON.stringify(project));
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: path.join(root, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
let page;
const errors = [];
const open = async () => {
  app = await electron.launch({ args: [".", file], env });
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator(".timeline-clip.image").click();
  await page.getByRole("tab", { name: "画面", exact: true }).click();
};
const field = (axis) =>
  page.getByRole("spinbutton", {
    name: `${axis === "width" ? "宽度" : "高度"} (px)`,
    exact: true,
  });
const dimensions = async (width, height) => {
  await expect(field("width")).toHaveValue(String(width));
  await expect(field("height")).toHaveValue(String(height));
};
const ratio = () =>
  page.locator(".preview-layer.image").evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    return bounds.width / bounds.height;
  });
const seek = (time) =>
  page.locator(".ruler").click({ position: { x: time * 65, y: 10 } });
try {
  await open();
  const lock = page.getByRole("button", { name: "锁定宽高比例", exact: true });
  await expect(lock).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() => lock.evaluate((node) => getComputedStyle(node).borderLeftWidth))
    .toBe("0px");
  await dimensions(200, 100);
  await field("width").fill("300");
  await dimensions(300, 150);
  await lock.click();
  await expect(lock).toHaveAttribute("aria-pressed", "false");
  await field("width").fill("240");
  await dimensions(240, 150);
  await field("height").fill("90");
  await dimensions(240, 90);
  await expect.poll(ratio).toBeCloseTo(240 / 90, 2);
  const layer = page.locator(".preview-layer.image");
  const original = await layer.boundingBox();
  const handle = await page
    .getByRole("button", { name: "调整尺寸 e", exact: true })
    .boundingBox();
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handle.x + handle.width / 2 + (20 * original.width) / 240,
    handle.y + handle.height / 2,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect
    .poll(() => field("width").inputValue().then(Number))
    .toBeCloseTo(260, 1);
  await expect(field("height")).toHaveValue("90");
  await expect
    .poll(async () => (await layer.boundingBox()).x)
    .toBeCloseTo(original.x, 1);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await dimensions(240, 90);
  await page
    .locator(".dimension-controls")
    .screenshot({ path: path.join(root, "unlocked.png") });
  await lock.click();
  await field("width").fill("480");
  await dimensions(480, 180);
  await field("height").fill("90");
  await dimensions(240, 90);
  await lock.click();
  await seek(2);
  await page.getByRole("button", { name: "自动动画", exact: true }).click();
  await field("width").fill("360");
  await dimensions(360, 90);
  await seek(0);
  await dimensions(240, 90);
  await seek(1.5);
  await dimensions(300, 90);
  await seek(2);
  await expect.poll(ratio).toBeCloseTo(4, 2);
  await page.getByTitle("保存工程 Ctrl+S", { exact: true }).click();
  await expect
    .poll(
      async () =>
        JSON.parse(await fs.readFile(file, "utf8")).clips[0].lockAspectRatio,
    )
    .toBe(false);
  await expect(
    page.getByRole("heading", { name: "正在处理…", exact: true }),
  ).toBeHidden();
  await app.close();
  await open();
  await expect(
    page.getByRole("button", { name: "锁定宽高比例", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await dimensions(240, 90);
  await seek(2);
  await dimensions(360, 90);
  await expect.poll(ratio).toBeCloseTo(4, 2);
  await page.getByRole("button", { name: "裁剪模式", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "锁定宽高比例", exact: true }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      root,
      checks:
        "去除竖线、锁定联动、解锁独立宽高、画布单轴拖动、撤销、重新锁定、独立轴关键帧、保存重开和裁剪模式保护",
      rendererErrors: errors,
    }),
  );
} catch (error) {
  await page
    ?.screenshot({ path: path.join(root, "failure.png") })
    .catch(() => {});
  console.error(root);
  throw error;
} finally {
  await app?.close();
}
