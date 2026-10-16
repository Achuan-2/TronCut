import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(`test-output/canvas-effect-drop-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
await sharp({
  create: { width: 320, height: 180, channels: 3, background: "#528bb1" },
})
  .png()
  .toFile(path.join(root, "image.png"));
execFileSync(
  "ffmpeg",
  [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-loop",
    "1",
    "-i",
    path.join(root, "image.png"),
    "-t",
    "5",
    "-r",
    "10",
    "-pix_fmt",
    "yuv420p",
    path.join(root, "video.mp4"),
  ],
  { windowsHide: true },
);
const bundled = await build({
  stdin: {
    contents:
      'export { createProject, newText, newTrack } from "./shared/model";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { createProject, newText, newTrack } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const project = createProject("画布效果拖放验证");
project.tracks = Array.from({ length: 4 }, (_, index) => newTrack(index));
project.tracks[3].locked = true;
project.assets = ["image", "video"].map((kind) => ({
  id: kind,
  name: kind,
  kind,
  path: kind === "image" ? "image.png" : "video.mp4",
  width: 320,
  height: 180,
  duration: kind === "image" ? 0 : 5,
  hasAudio: false,
}));
project.clips = ["video", "image", "text", "locked"].map((id, index) => {
  const clip = newText(project.tracks[index].id, 0, 0, "文字对象");
  clip.id = id;
  clip.name = id;
  clip.duration = 5;
  if (id !== "text") {
    clip.kind = id === "video" ? "video" : "image";
    clip.assetId = id === "video" ? "video" : "image";
  }
  clip.transform = {
    x: index % 2 === 0 ? 0.25 : 0.75,
    y: index < 2 ? 0.25 : 0.75,
    scale: id === "text" ? 1 : 0.32,
    opacity: 1,
  };
  return clip;
});
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
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  const layer = (id) =>
    page.locator(`.canvas .preview-layer[data-clip-id="${id}"]`);
  const highlighted = page.locator(".canvas .effect-drop-target");
  const save = async () => {
    await page.getByTitle("保存工程 Ctrl+S", { exact: true }).click();
    await expect(page.locator(".project-save-state")).not.toContainText("*");
    return JSON.parse(await fs.readFile(file, "utf8"));
  };
  const startDrag = async (source, target) => {
    const from = await source.boundingBox();
    const to = await target.boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      from.x + from.width / 2 + 10,
      from.y + from.height / 2,
      { steps: 3 },
    );
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
      steps: 15,
    });
    await page.mouse.move(to.x + to.width / 2 + 1, to.y + to.height / 2);
  };
  const transfer = async (kind, value) =>
    page.evaluateHandle(
      ({ kind, value }) => {
        const data = new DataTransfer();
        data.setData(`troncut-${kind}`, value);
        if (kind === "effect") data.setData(`troncut-effect/${value}`, value);
        return data;
      },
      { kind, value },
    );
  await expect(layer("video")).toBeVisible();
  await page.getByRole("button", { name: "视觉效果", exact: true }).click();
  const rounded = page.locator(
    '.visual-effect-card[data-effect="rounded-corners"]',
  );
  const speed = page.locator('.visual-effect-card[data-effect="clip-speed"]');

  // Exercise a real HTML drag, including protected dragover data and hit testing.
  await startDrag(rounded, layer("image"));
  await expect(layer("image")).toHaveClass(/effect-drop-target/);
  await expect(layer("image")).not.toHaveClass(/\bselected\b/);
  await expect
    .poll(() =>
      layer("image").evaluate(
        (node) => getComputedStyle(node, "::after").animationName,
      ),
    )
    .toBe("canvas-effect-target-pulse");
  await page.screenshot({ path: path.join(root, "hover.png") });
  await page.mouse.up();
  await expect(highlighted).toHaveCount(0);
  await expect(layer("image")).toHaveClass(/\bselected\b/);
  await expect
    .poll(
      async () =>
        (await save()).clips.find((c) => c.id === "image").mediaFrame?.enabled,
    )
    .toBe(true);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect
    .poll(
      async () => (await save()).clips.find((c) => c.id === "image").mediaFrame,
    )
    .toBeUndefined();

  await speed.dragTo(layer("video"));
  await expect(page.locator(".clip-speed-effect")).toHaveCount(1);
  await expect(layer("video")).toHaveClass(/\bselected\b/);

  // Hover compatibility, descendant transitions, cancellation and locked tracks.
  const roundedData = await transfer("effect", "rounded-corners");
  const speedData = await transfer("effect", "clip-speed");
  for (const [id, data] of [
    ["text", roundedData],
    ["image", speedData],
    ["locked", roundedData],
  ]) {
    await layer(id).dispatchEvent("dragover", { dataTransfer: data });
    await expect(highlighted).toHaveCount(0);
    await layer(id).dispatchEvent("drop", { dataTransfer: data });
  }
  await layer("image").dispatchEvent("dragover", { dataTransfer: roundedData });
  await layer("image").evaluate((node) =>
    node.dispatchEvent(
      new DragEvent("dragleave", {
        bubbles: true,
        relatedTarget: node.querySelector("img"),
      }),
    ),
  );
  await expect(highlighted).toHaveCount(1);
  await page.evaluate(() => window.dispatchEvent(new DragEvent("dragend")));
  await expect(highlighted).toHaveCount(0);
  await layer("image").dispatchEvent("dragover", { dataTransfer: roundedData });
  await layer("image").dispatchEvent("dragleave");
  await expect(highlighted).toHaveCount(0);

  const behaviorData = await transfer("behavior", "pop");
  await layer("text").dispatchEvent("dragover", { dataTransfer: behaviorData });
  await expect(layer("text")).toHaveClass(/effect-drop-target/);
  await layer("text").dispatchEvent("drop", { dataTransfer: behaviorData });
  await expect(highlighted).toHaveCount(0);
  await expect(page.locator(".clip-behavior-effect")).toHaveCount(1);

  await rounded.dragTo(page.locator(".timeline-clip.image:not(.locked)"));
  await expect
    .poll(
      async () =>
        (await save()).clips.find((c) => c.id === "image").mediaFrame?.enabled,
    )
    .toBe(true);
  const saved = await save();
  expect(saved.clips.find((c) => c.id === "locked").mediaFrame).toBeUndefined();
  expect(saved.clips.find((c) => c.id === "image").speedEffect).toBeUndefined();
  expect(saved.clips.find((c) => c.id === "text").mediaFrame).toBeUndefined();
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      root,
      checks:
        "画布原生拖放、目标动画、效果附加、撤销、类型限制、锁定、移出与取消、行为高亮、时间轴回归",
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
