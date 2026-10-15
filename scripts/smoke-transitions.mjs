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
    page.getByRole("button", { name: "Smooth Slide", exact: false }),
  ).toBeVisible();

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
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 15);
  await page.mouse.down();
  await page.mouse.move(handle.x - 25, handle.y + 15, { steps: 5 });
  await page.mouse.up();
  expect((await marker.boundingBox()).width).toBeGreaterThan(
    initial.width + 10,
  );
  await page.screenshot({ path: path.join(root, "junction-added.png") });

  await page.getByTitle("保存工程 Ctrl+S").click();
  await expect(page.locator(".toast")).toContainText("工程已保存");
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
  expect(errors).toEqual([]);
  console.log(`转换桌面交互验证通过：${root}`);
} finally {
  await app.close();
}
