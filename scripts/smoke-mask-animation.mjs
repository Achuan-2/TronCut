import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(`test-output/mask-animation-ui-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
await sharp({
  create: { width: 320, height: 180, channels: 3, background: "#00ff00" },
})
  .png()
  .toFile(path.join(root, "image.png"));
const bundled = await build({
  stdin: {
    contents:
      'export { createProject, newText } from "./shared/model"; export { defaultVisualEffect } from "./shared/visual-effects";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { createProject, newText, defaultVisualEffect } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const project = createProject("遮罩滑动显示");
project.canvas = { width: 320, height: 180, fps: 10, background: "#5432b2" };
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
project.clips = [
  {
    ...newText("video", 0),
    id: "source",
    kind: "image",
    assetId: "image",
    duration: 3,
    transform: { x: 0.5, y: 0.5, scale: 0.8, opacity: 1 },
    visualEffects: {
      mask: {
        ...defaultVisualEffect("mask"),
        shape: "rectangle",
        width: 0.1,
        height: 1,
        x: 0.05,
        feather: 0,
      },
    },
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
  const seek = async (time) => {
    await page.locator(".ruler").click({ position: { x: time * 65, y: 12 } });
    await expect
      .poll(async () =>
        Number(await page.getByLabel("播放进度", { exact: true }).inputValue()),
      )
      .toBeCloseTo(time, 4);
  };
  const save = async () => {
    await page.getByTitle("保存工程 Ctrl+S", { exact: true }).click();
    await expect(page.locator(".project-save-state")).not.toContainText("*");
    return JSON.parse(await fs.readFile(file, "utf8"));
  };
  const pixel = async (name, x) => {
    const png = await page
      .locator(".canvas")
      .screenshot({ path: path.join(root, `${name}.png`) });
    const { data, info } = await sharp(png)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const offset =
      (Math.floor(info.height * 0.5) * info.width +
        Math.floor(info.width * x)) *
      3;
    return [...data.subarray(offset, offset + 3)];
  };
  await expect(page.locator(".timeline-clip.image")).toBeVisible();
  await page.locator(".timeline-clip.image").click();
  await expect(page.locator(".effect-region-resize")).toHaveCount(8);
  await seek(2);
  await page.getByRole("button", { name: "自动动画", exact: true }).click();
  const source = page.locator('.canvas .preview-layer[data-clip-id="source"]');
  const bounds = await source.boundingBox();
  const east = page.getByRole("button", {
    name: "调整遮罩区域 e",
    exact: true,
  });
  const handle = await east.boundingBox();
  const x = handle.x + handle.width / 2,
    y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width, y, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".clip-animation")).toHaveCount(1);
  let saved = await save();
  const clip = saved.clips[0];
  expect(clip.transform).toMatchObject(project.clips[0].transform);
  expect(clip.keyframes.at(-1).value.maskWidth).toBeCloseTo(1, 2);
  expect(
    clip.keyframes.at(-1).value.maskX -
      clip.keyframes.at(-1).value.maskWidth / 2,
  ).toBeCloseTo(0, 3);
  for (const [time, visible, hidden] of [
    [0.5, 0.14, 0.4],
    [1.5, 0.4, 0.8],
    [2.5, 0.8, -1],
  ]) {
    await seek(time);
    expect((await pixel(`reveal-${time}`, visible))[1]).toBeGreaterThan(240);
    if (hidden >= 0)
      expect((await pixel(`hidden-${time}`, hidden))[2]).toBeGreaterThan(160);
  }
  await page.locator(".animation-point.start").click();
  await page.getByLabel("遮罩区域宽度 (%)", { exact: true }).fill("20");
  saved = await save();
  expect(
    saved.clips[0].keyframes.find((frame) => frame.time === 1).value.maskWidth,
  ).toBe(0.2);
  expect(
    saved.clips[0].keyframes.find((frame) => frame.time === 2).value.maskWidth,
  ).toBeCloseTo(1, 2);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await page.locator(".animation-point.end").click();
  await page.getByLabel("遮罩区域宽度 (%)", { exact: true }).fill("80");
  saved = await save();
  expect(
    saved.clips[0].keyframes.find((frame) => frame.time === 1).value.maskWidth,
  ).toBe(0.1);
  expect(
    saved.clips[0].keyframes.find((frame) => frame.time === 2).value.maskWidth,
  ).toBe(0.8);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  const end = await page.locator(".animation-point.end").boundingBox();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2 + 32.5, end.y + end.height / 2, {
    steps: 5,
  });
  await page.mouse.up();
  await expect(page.locator(".clip-animation")).toHaveAttribute(
    "data-end",
    "2.5",
  );
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await seek(1.5);
  const beforeCancel = (await save()).clips[0].keyframes;
  const region = await page
    .getByRole("group", { name: "遮罩编辑区域", exact: true })
    .boundingBox();
  await page.mouse.move(
    region.x + region.width / 2,
    region.y + region.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    region.x + region.width / 2 + 40,
    region.y + region.height / 2,
    { steps: 3 },
  );
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect((await save()).clips[0].keyframes).toEqual(beforeCancel);
  await app.close();
  app = await electron.launch({ args: [".", file], env });
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.locator(".clip-animation")).toHaveCount(1);
  await seek(1.5);
  expect((await pixel("reopened", 0.4))[1]).toBeGreaterThan(240);
  expect((await pixel("reopened-hidden", 0.8))[2]).toBeGreaterThan(160);
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      root,
      checks:
        "八个控制点、固定对边缩放、自动动画、滑动显示像素、起止端点、撤销、时长拖动、取消、保存重开",
      rendererErrors: errors,
    }),
  );
} catch (error) {
  if (app)
    await (
      await app.firstWindow()
    )
      .screenshot({ path: path.join(root, "failure.png") })
      .catch(() => {});
  console.error(root);
  throw error;
} finally {
  await app?.close();
}
