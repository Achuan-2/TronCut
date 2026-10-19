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
    const before = (await fs.stat(file)).mtimeMs;
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect
      .poll(async () => (await fs.stat(file)).mtimeMs)
      .toBeGreaterThan(before);
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
    // Sample above the center so the editing control cannot cover the pixel.
    const offset =
      (Math.floor(info.height * 0.35) * info.width +
        Math.floor(info.width * x)) *
      3;
    return [...data.subarray(offset, offset + 3)];
  };
  await expect(page.locator(".timeline-clip.image")).toBeVisible();
  await page.locator(".timeline-clip.image").click();
  await expect(page.locator(".effect-region-resize")).toHaveCount(8);
  const region = page.getByRole("group", {
    name: "遮罩编辑区域",
    exact: true,
  });
  const moveHandle = page.getByRole("button", {
    name: "移动遮罩区域",
    exact: true,
  });
  await expect(moveHandle).toHaveCount(0);
  const maskHeading = page
    .getByRole("region", { name: "遮罩属性", exact: true })
    .getByRole("heading", { name: "遮罩", exact: true });
  await maskHeading.click();
  await expect(moveHandle).toBeVisible();
  await maskHeading.click();
  const selectMask = () =>
    page.getByRole("button", { name: "视觉效果 遮罩", exact: true }).click();
  const undo = () => page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  const dragFrom = async (x, y, dx, dy) => {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 8 });
    await page.mouse.up();
  };
  // The region body and its dashed border must pass dragging to the material.
  for (const part of ["body", "center", "border"]) {
    const box = await region.boundingBox();
    await dragFrom(
      box.x + box.width * (part === "center" ? 0.5 : 0.25),
      box.y +
        (part === "border"
          ? 0.5
          : box.height * (part === "center" ? 0.5 : 0.25)),
      35,
      15,
    );
    const moved = (await save()).clips[0];
    expect(moved.transform.x).toBeGreaterThan(project.clips[0].transform.x);
    expect(moved.transform.y).toBeGreaterThan(project.clips[0].transform.y);
    expect(moved.visualEffects.mask).toEqual(
      project.clips[0].visualEffects.mask,
    );
    await expect(moveHandle).toHaveCount(0);
    await undo();
    expect((await save()).clips[0].transform).toEqual(
      project.clips[0].transform,
    );
  }
  // The center icon (including its SVG child) moves only the mask.
  await selectMask();
  await expect(moveHandle).toBeVisible();
  const center = await moveHandle.boundingBox();
  await dragFrom(
    center.x + center.width / 2,
    center.y + center.height / 2,
    40,
    18,
  );
  const movedMask = (await save()).clips[0];
  expect(movedMask.transform).toEqual(project.clips[0].transform);
  expect(movedMask.visualEffects.mask.x).toBeGreaterThan(
    project.clips[0].visualEffects.mask.x,
  );
  expect(movedMask.visualEffects.mask.y).toBeGreaterThan(
    project.clips[0].visualEffects.mask.y,
  );
  expect(movedMask.visualEffects.mask.width).toBe(
    project.clips[0].visualEffects.mask.width,
  );
  expect(movedMask.visualEffects.mask.height).toBe(
    project.clips[0].visualEffects.mask.height,
  );
  await page.screenshot({ path: path.join(root, "mask-move-control.png") });
  await undo();
  expect((await save()).clips[0].visualEffects.mask).toEqual(
    project.clips[0].visualEffects.mask,
  );
  await page
    .locator(".timeline-clip.image")
    .click({ position: { x: 35, y: 18 } });
  await expect(moveHandle).toHaveCount(0);
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
  await expect(moveHandle).toBeVisible();
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
  await expect(
    page.getByLabel("遮罩区域宽度 (%)", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("遮罩区域高度 (%)", { exact: true }),
  ).toHaveCount(0);
  await page.locator(".animation-point.start").click();
  const dragControl = async (control, deltaX) => {
    const handle = await control.boundingBox();
    const x = handle.x + handle.width / 2,
      y = handle.y + handle.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + deltaX, y, { steps: 6 });
    await page.mouse.up();
  };
  const dragHandle = (name, deltaX) =>
    dragControl(
      page.getByRole("button", {
        name: `调整遮罩区域 ${name}`,
        exact: true,
      }),
      deltaX,
    );
  const currentBounds = await source.boundingBox();
  await dragHandle("e", currentBounds.width * 0.1);
  saved = await save();
  expect(
    saved.clips[0].keyframes.find((frame) => frame.time === 1).value.maskWidth,
  ).toBeCloseTo(0.2, 2);
  expect(
    saved.clips[0].keyframes.find((frame) => frame.time === 2).value.maskWidth,
  ).toBeCloseTo(1, 2);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await seek(2);
  await page.locator(".animation-point.end").click();
  await page.getByLabel("遮罩不透明度 (%)", { exact: true }).fill("40");
  saved = await save();
  expect(
    saved.clips[0].keyframes.find((frame) => frame.time === 1).value
      .maskOpacity,
  ).toBe(0);
  expect(
    saved.clips[0].keyframes.find((frame) => frame.time === 2).value
      .maskOpacity,
  ).toBeCloseTo(0.4, 2);
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
  await selectMask();
  const beforeCancel = (await save()).clips[0].keyframes;
  const cancelHandle = await moveHandle.boundingBox();
  await page.mouse.move(
    cancelHandle.x + cancelHandle.width / 2,
    cancelHandle.y + cancelHandle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    cancelHandle.x + cancelHandle.width / 2 + 40,
    cancelHandle.y + cancelHandle.height / 2,
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
        "控制点按遮罩选择显隐、中央控制点移动遮罩、区域及边框拖动素材、八点缩放、自动动画、滑动显示像素、起止端点、撤销、时长拖动、取消、保存重开",
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
