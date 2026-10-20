import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(`test-output/rounded-corners-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const bundled = await build({
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
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const source = path.join(root, "image.png");
await sharp({
  create: { width: 400, height: 200, channels: 3, background: "#00c800" },
})
  .png()
  .toFile(source);
const project = createProject("圆角百分比");
project.canvas = { width: 800, height: 400, fps: 30, background: "#5432b2" };
project.assets = [
  {
    id: "image",
    name: "图片",
    path: "image.png",
    kind: "image",
    width: 400,
    height: 200,
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
    crop: { left: 0.5, right: 0, top: 0, bottom: 0 },
    mediaFrame: { radius: 40 },
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
let page;
const errors = [];
const open = async () => {
  app = await electron.launch({ args: [".", file], env });
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator(".timeline-clip.image").click();
  await page.getByRole("tab", { name: "画面", exact: true }).click();
};
// The preview zoom cancels out in this ratio; transform.scale lives outside the mask.
const radiusRatio = () =>
  page
    .locator(".preview-layer.image .preview-effect-content > div")
    .first()
    .evaluate((node) => {
      const css = getComputedStyle(node);
      return (
        parseFloat(css.borderTopLeftRadius) /
        Math.min(node.clientWidth, node.clientHeight)
      );
    });
try {
  await open();
  const input = page.getByRole("spinbutton", { name: "圆角 (%)", exact: true });
  await expect(input).toHaveValue("20"); // Legacy 40px / (cropped 400px / 2).
  await expect.poll(radiusRatio).toBeCloseTo(0.1, 2);
  await input.fill("100");
  await expect.poll(radiusRatio).toBeCloseTo(0.5, 2);
  const slider = page.getByRole("slider", {
    name: "圆角半径百分比滑条",
    exact: true,
  });
  await expect(slider).toHaveAttribute("max", "100");
  await slider.focus();
  await page.keyboard.press("Home");
  await expect(input).toHaveValue("0");
  await expect.poll(radiusRatio).toBe(0);
  await page.keyboard.press("End");
  await expect(input).toHaveValue("100");
  const corner = page.getByRole("button", { name: "圆角左上", exact: true });
  await corner.click();
  await expect.poll(radiusRatio).toBe(0);
  await corner.click();
  const enabled = page.getByRole("switch", {
    name: "启用圆角倒角",
    exact: true,
  });
  await enabled.uncheck();
  await expect(input).toBeDisabled();
  await expect.poll(radiusRatio).toBe(0);
  await enabled.check();
  await expect.poll(radiusRatio).toBeCloseTo(0.5, 2);
  await page.getByLabel("圆角倒角选项", { exact: true }).click();
  await page.getByRole("button", { name: "重置圆角倒角", exact: true }).click();
  await expect(input).toHaveValue("20");
  await input.fill("75");
  await expect.poll(radiusRatio).toBeCloseTo(0.375, 2);
  await page.getByTitle("保存项目 Ctrl+S", { exact: true }).click();
  await expect
    .poll(
      async () =>
        JSON.parse(await fs.readFile(file, "utf8")).clips[0].mediaFrame,
    )
    .toMatchObject({ radius: 75, unit: "percent" });
  await expect(page.getByRole("heading", { name: "正在处理…", exact: true })).toBeHidden();
  await page.screenshot({ path: path.join(root, "percent.png") });
  await app.close();
  await open();
  await expect(
    page.getByRole("spinbutton", { name: "圆角 (%)", exact: true }),
  ).toHaveValue("75");
  await expect.poll(radiusRatio).toBeCloseTo(0.375, 2);
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      root,
      checks: "旧像素换算、裁切比例、滑条上下限、单角、禁用、重置、保存重开",
      rendererErrors: errors,
    }),
  );
} catch (error) {
  await page
    ?.screenshot({ path: path.join(root, "failure.png") })
    .catch(() => { });
  throw error;
} finally {
  await app?.close();
}
