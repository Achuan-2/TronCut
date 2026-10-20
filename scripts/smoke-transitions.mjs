import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(`test-output/transitions-ui-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
for (const [name, background] of [
  ["red", "#ec5349"],
  ["blue", "#3289d4"],
])
  await sharp({ create: { width: 160, height: 90, channels: 3, background } })
    .png()
    .toFile(path.join(root, `${name}.png`));

const clips = ["red", "blue"].map((id, index) => ({
  id,
  trackId: "video",
  assetId: id,
  kind: "image",
  name: id,
  start: index * 3,
  duration: 3,
  sourceIn: 0,
  speed: 1,
  transform: { x: 0.5, y: 0.5, scale: 1, opacity: 1 },
  keyframes: [],
  volume: 1,
  podcast: false,
}));
const project = {
  format: "troncut",
  version: 1,
  id: "transition-test",
  name: "转换交互验证",
  canvas: { width: 640, height: 360, fps: 30, background: "#101319" },
  tracks: [
    { id: "video", name: "轨道1", hidden: false, muted: false, locked: false },
  ],
  clips,
  assets: ["red", "blue"].map((id) => ({
    id,
    name: id,
    path: `${id}.png`,
    kind: "image",
    duration: 0,
    width: 160,
    height: 90,
    hasAudio: false,
  })),
  markers: [],
};
const file = path.join(root, "project.troncut");
await fs.writeFile(file, JSON.stringify(project));
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: path.join(root, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [".", file], env, timeout: 30_000 });
const errors = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.locator(".timeline-clip")).toHaveCount(2);
  await page.getByRole("button", { name: "转换", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "平滑切换", exact: false }),
  ).toBeVisible();
  await expect(page.locator(".transition-card")).toHaveCount(4);
  for (const name of ["放大", "淡入淡出", "横扫"])
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  await expect(page.locator(".transition-card > b")).toHaveText([
    "平滑切换",
    "横扫",
    "放大",
    "淡入淡出",
  ]);

  // Check rendered pixels at a naturally reached blur peak, including after
  // leaving and reopening the panel; a filter URL alone proves no visual effect.
  const blurChecks = [];
  for (const pass of ["initial", "reopened"]) {
    if (pass === "reopened") {
      await page.getByRole("button", { name: "媒体", exact: true }).click();
      await page.getByRole("button", { name: "转换", exact: true }).click();
    }
    const preview = page.locator(".transition-card-preview.whip-pan");
    await preview.locator("img").evaluateAll(async (images) => {
      await Promise.all(images.map((image) => image.decode()));
    });
    await expect
      .poll(() =>
        page
          .locator(".transitions-panel feGaussianBlur")
          .evaluate((blur) => blur.stdDeviationX.animVal),
      )
      .toBeGreaterThan(0.07);
    const sample = await preview.evaluate((element) => {
      const svg = document.querySelector(".transitions-panel > svg");
      const blur = svg.querySelector("feGaussianBlur");
      svg.pauseAnimations();
      const animations = [...element.querySelectorAll("img")].flatMap((image) =>
        image.getAnimations(),
      );
      animations.forEach((animation) => animation.pause());
      return {
        x: blur.stdDeviationX.animVal,
        y: blur.stdDeviationY.animVal,
        cssTime: Number(animations[0].currentTime) % 2400,
      };
    });
    expect(sample.x).toBeGreaterThan(0.07);
    expect(sample.y).toBe(0);
    const blurred = await preview.screenshot({
      path: path.join(root, `card-${pass}-blurred.png`),
    });
    await preview.locator("img").evaluateAll((images) => {
      images.forEach((image) => (image.style.filter = "none"));
    });
    const clear = await preview.screenshot({
      path: path.join(root, `card-${pass}-clear.png`),
    });
    const pixels = await sharp(blurred).removeAlpha().raw().toBuffer();
    const reference = await sharp(clear).removeAlpha().raw().toBuffer();
    const difference =
      pixels.reduce(
        (sum, value, index) => sum + Math.abs(value - reference[index]),
        0,
      ) / pixels.length;
    expect(difference).toBeGreaterThan(3);
    blurChecks.push({ pass, ...sample, difference });
    await preview.locator("img").evaluateAll((images) => {
      const filter = document.querySelector(
        ".transitions-panel > svg filter",
      ).id;
      images.forEach((image) => {
        image.style.filter = `url(#${filter})`;
        image
          .getAnimations()
          .forEach((animation) => (animation.currentTime = 0));
      });
    });
    await expect
      .poll(() =>
        page
          .locator(".transitions-panel feGaussianBlur")
          .evaluate((blur) => blur.stdDeviationX.animVal),
      )
      .toBe(0);
    await preview.screenshot({
      path: path.join(root, `card-${pass}-rest.png`),
    });
    await preview.locator("img").evaluateAll((images) => {
      images.forEach((image) =>
        image.getAnimations().forEach((animation) => animation.play()),
      );
    });
    await page
      .locator(".transitions-panel > svg")
      .evaluate((svg) => svg.unpauseAnimations());
  }
  await fs.writeFile(
    path.join(root, "card-blur-checks.json"),
    JSON.stringify(blurChecks, null, 2),
  );

  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.setData("troncut-transition", "smooth-slide");
    return data;
  });
  const red = page.locator(".timeline-clip").filter({ hasText: "red" });
  const blue = page.locator(".timeline-clip").filter({ hasText: "blue" });
  const bounds = await red.boundingBox();
  await red.dispatchEvent("dragover", {
    dataTransfer: transfer,
    clientX: bounds.x + bounds.width - 2,
    clientY: bounds.y + 20,
  });
  await expect(red.locator(".transition-drop-edge.outgoing")).toHaveCount(1);
  await expect(blue.locator(".transition-drop-edge.incoming")).toHaveCount(1);
  await page.screenshot({ path: path.join(root, "junction-highlight.png") });
  await red.dispatchEvent("drop", {
    dataTransfer: transfer,
    clientX: bounds.x + bounds.width - 2,
    clientY: bounds.y + 20,
  });
  await expect(page.locator(".timeline-transition")).toHaveCount(2);
  await red
    .locator(".timeline-transition.outgoing")
    .click({ position: { x: 3, y: 15 } });
  await expect(page.locator(".panel-heading")).toContainText("转换");
  await expect(page.locator(".transition-fields select")).toHaveValue(
    "smooth-slide",
  );
  await page.getByLabel("反转").check();
  await page.getByRole("switch", { name: "启用转换" }).click();

  // Type changes update both sides of the junction.
  for (const [type, name] of [
    ["zoom", "放大"],
    ["fade", "淡入淡出"],
    ["whip-pan", "横扫"],
  ]) {
    await page.locator(".transition-fields select").selectOption(type);
    await expect(red.locator(".timeline-transition.outgoing")).toHaveAttribute(
      "title",
      new RegExp(name),
    );
    await expect(blue.locator(".timeline-transition.incoming")).toHaveAttribute(
      "title",
      new RegExp(name),
    );
  }
  await page.locator(".transition-fields select").selectOption("smooth-slide");
  await expect(red.locator(".timeline-transition.outgoing")).toHaveClass(
    /disabled/,
  );
  await expect(blue.locator(".timeline-transition.incoming")).toHaveClass(
    /disabled/,
  );
  await page.getByRole("switch", { name: "启用转换" }).click();

  const marker = red.locator(".timeline-transition.outgoing");
  const initial = await marker.boundingBox();
  const handle = await marker
    .getByRole("separator", { name: "调整转换时长" })
    .boundingBox();
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(handle.x - 25, handle.y + handle.height / 2, {
    steps: 5,
  });
  await page.mouse.up();
  await expect
    .poll(async () => (await marker.boundingBox()).width)
    .toBeGreaterThan(initial.width + 10);
  await page.screenshot({ path: path.join(root, "junction-added.png") });

  await page.getByTitle("保存项目 Ctrl+S").click();
  await expect(page.locator(".toast")).toContainText("项目已保存");
  await expect
    .poll(
      async () =>
        JSON.parse(await fs.readFile(file, "utf8")).clips[0].transitions
          ?.outgoing?.reverse,
    )
    .toBe(true);
  const saved = JSON.parse(await fs.readFile(file, "utf8"));
  expect(saved.clips[0].transitions.outgoing.duration).toBeGreaterThan(1);
  expect(saved.clips[0].transitions.outgoing.pairId).toBe(
    saved.clips[1].transitions.incoming.pairId,
  );

  await page.getByRole("button", { name: "删除转换" }).click();
  await expect(page.locator(".timeline-transition")).toHaveCount(0);
  await expect(page.locator(".timeline-clip")).toHaveCount(2);
  await page.getByTitle("撤销 Ctrl+Z").click();
  await expect(page.locator(".timeline-transition")).toHaveCount(2);

  // New presets also travel through drag payloads and double-click application.
  await red
    .locator(".timeline-transition.outgoing")
    .click({ position: { x: 10, y: 5 } });
  await page.getByRole("button", { name: "删除转换" }).click();
  for (const [type, name] of [
    ["zoom", "放大"],
    ["fade", "淡入淡出"],
    ["whip-pan", "横扫"],
  ]) {
    const payload = await page.evaluateHandle((value) => {
      const data = new DataTransfer();
      data.setData("troncut-transition", value);
      return data;
    }, type);
    const box = await red.boundingBox();
    await red.dispatchEvent("drop", {
      dataTransfer: payload,
      clientX: box.x + box.width - 2,
      clientY: box.y + 20,
    });
    await expect(page.locator(".transition-fields select")).toHaveValue(type);
    await expect(blue.locator(".timeline-transition.incoming")).toHaveAttribute(
      "title",
      new RegExp(name),
    );
    await page.getByLabel("播放进度", { exact: true }).evaluate((el) => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set;
      setValue.call(el, "3");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const incomingLayer = page.locator('.preview-layer[data-clip-id="blue"]');
    await expect(incomingLayer).toBeVisible();
    await expect
      .poll(async () =>
        Number(
          await incomingLayer.evaluate((el) => getComputedStyle(el).opacity),
        ),
      )
      .toBeCloseTo(type === "whip-pan" ? 1 : 0.5, 1);
    const matrix = await incomingLayer.evaluate((el) => {
      const transform = new DOMMatrix(getComputedStyle(el).transform);
      return { x: transform.a, y: transform.d };
    });
    expect(matrix.x / matrix.y).toBeCloseTo(type === "whip-pan" ? 1.16 : 1, 2);
    expect(matrix.y).toBeCloseTo(type === "zoom" ? 0.86 : 1, 2);
    await page.screenshot({ path: path.join(root, `preview-${type}.png`) });
    await page.getByRole("button", { name: "删除转换" }).click();
    await page.getByRole("button", { name, exact: true }).dblclick();
    await expect(page.locator(".transition-fields select")).toHaveValue(type);
    await expect(page.locator(".timeline-transition")).toHaveCount(2);
    await page.getByRole("button", { name: "删除转换" }).click();
    // A middle double-click applies independent transitions to both ends.
    await red
      .locator(".timeline-transition")
      .click({ position: { x: 3, y: 15 } });
    await page.getByRole("button", { name: "删除转换" }).click();
    await payload.dispose();
  }
  await page.screenshot({ path: path.join(root, "transition-presets.png") });
  expect(errors).toEqual([]);
  console.log(`转换桌面交互验证通过：${root}`);
} finally {
  await app.close();
}
