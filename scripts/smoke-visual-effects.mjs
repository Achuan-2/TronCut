import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { execFileSync } from "node:child_process";

const root = path.resolve(`test-output/visual-effects-ui-${Date.now()}`);
const bundledFfmpeg = path.resolve(
  "resources/bin",
  process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
);
const ffmpeg =
  process.env.FRAMECRAFT_FFMPEG ??
  (await fs.access(bundledFfmpeg).then(
    () => bundledFfmpeg,
    () => "ffmpeg",
  ));
await fs.mkdir(root, { recursive: true });
await sharp(
  Buffer.from(
    '<svg width="320" height="180"><rect width="160" height="180" fill="#00ff00"/><rect x="160" width="160" height="180" fill="#ff0000"/></svg>',
  ),
)
  .png()
  .toFile(path.join(root, "image.png"));
const bundled = await build({
  stdin: {
    contents:
      'export { createProject, newText, newTrack } from "./shared/model"; export { additionalVisualEffectPresets } from "./shared/visual-effects";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { createProject, newText, newTrack, additionalVisualEffectPresets } =
  await import(
    `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
  );
const project = createProject("七项视觉效果验证");
project.canvas = { width: 320, height: 180, fps: 10, background: "#101319" };
project.tracks = [newTrack(0), newTrack(1)];
project.assets = [
  {
    id: "image",
    name: "image",
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
    ...newText(project.tracks[0].id, 0),
    id: "source",
    kind: "image",
    assetId: "image",
    duration: 5,
    transform: { x: 0.5, y: 0.5, scale: 0.65, opacity: 1 },
  },
  {
    ...newText(project.tracks[1].id, 0),
    id: "under",
    kind: "shape",
    shape: "rectangle",
    fill: "#2244aa",
    duration: 5,
    transform: { x: 0.5, y: 0.5, scale: 2, opacity: 1 },
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
  await expect(page.locator(".timeline-clip")).toHaveCount(2);
  await page.getByRole("button", { name: "视觉效果", exact: true }).click();
  await expect(page.locator(".visual-effect-card")).toHaveCount(9);
  const source = page.locator('.canvas .preview-layer[data-clip-id="source"]');
  const pixels = async (name) => {
    const screenshot = await page
      .locator(".canvas")
      .screenshot({ path: path.join(root, `${name}.png`) });
    const { data, info } = await sharp(screenshot)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return (x, y) => {
      const offset =
        (Math.floor(y * info.height) * info.width +
          Math.floor(x * info.width)) *
        3;
      return [...data.subarray(offset, offset + 3)];
    };
  };
  const near = (actual, expected, tolerance = 12) =>
    actual.forEach((channel, i) =>
      expect(Math.abs(channel - expected[i])).toBeLessThan(tolerance),
    );
  const save = async () => {
    const before = (await fs.stat(file)).mtimeMs;
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect
      .poll(async () => (await fs.stat(file)).mtimeMs)
      .toBeGreaterThan(before);
    await expect(page.locator(".project-save-state")).not.toContainText("*");
    return JSON.parse(await fs.readFile(file, "utf8"));
  };
  for (const { id, name } of additionalVisualEffectPresets) {
    await page
      .locator(`.visual-effect-card[data-effect="${id}"]`)
      .dragTo(source);
    const properties = page.getByRole("region", {
      name: `${name}属性`,
      exact: true,
    });
    await expect(properties).toBeVisible();
    await expect(
      page.getByRole("switch", { name: `启用${name}`, exact: true }),
    ).toBeChecked();
    const saved = await save();
    expect(
      saved.clips.find((clip) => clip.id === "source").visualEffects[id]
        .enabled,
    ).toBe(true);
    if (id === "mask" || id === "blur-region") {
      if (id === "mask")
        await page
          .getByRole("button", { name: `视觉效果 ${name}`, exact: true })
          .click();
      const region = page.getByRole("group", {
        name: `${name}编辑区域`,
        exact: true,
      });
      const bounds = await (
        id === "mask"
          ? region.getByRole("button", { name: `移动${name}区域`, exact: true })
          : region
      ).boundingBox();
      await page.mouse.move(
        bounds.x + bounds.width * 0.3,
        bounds.y + bounds.height * 0.5,
      );
      await page.mouse.down();
      await page.mouse.move(
        bounds.x + bounds.width * 0.3 + 20,
        bounds.y + bounds.height * 0.5 + 10,
        { steps: 4 },
      );
      await page.mouse.up();
      await expect
        .poll(
          async () =>
            (await save()).clips.find((clip) => clip.id === "source")
              .visualEffects[id].x,
        )
        .toBeGreaterThan(0.5);
      await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
      await expect
        .poll(
          async () =>
            (await save()).clips.find((clip) => clip.id === "source")
              .visualEffects[id].x,
        )
        .toBe(0.5);
      const handle = page.getByRole("button", {
        name: `调整${name}区域大小`,
        exact: true,
      });
      const corner = await handle.boundingBox();
      await page.mouse.move(
        corner.x + corner.width / 2,
        corner.y + corner.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        corner.x + corner.width / 2 + 20,
        corner.y + corner.height / 2 + 10,
        { steps: 4 },
      );
      await page.mouse.up();
      await expect
        .poll(
          async () =>
            (await save()).clips.find((clip) => clip.id === "source")
              .visualEffects[id].width,
        )
        .toBeGreaterThan(
          saved.clips.find((clip) => clip.id === "source").visualEffects[id]
            .width,
        );
      await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
    }
    if (id === "tint")
      await page.getByLabel("着色颜色", { exact: true }).fill("#0000ff");
    if (id === "shadow") {
      await page.getByLabel("阴影角度 (°)", { exact: true }).fill("0");
      await page.getByLabel("阴影偏移", { exact: true }).fill("40");
      await page.getByLabel("阴影不透明度 (%)", { exact: true }).fill("100");
      await page.getByLabel("阴影模糊", { exact: true }).fill("0");
    }
    if (id === "border")
      await page.getByLabel("边框粗细", { exact: true }).fill("20");
    let pixel = await pixels(id);
    if (id === "remove-color") {
      near(pixel(0.3, 0.5), [34, 68, 170]);
      near(pixel(0.7, 0.5), [255, 0, 0]);
    }
    if (id === "tint") near(pixel(0.3, 0.5), [0, 0, 182]);
    if (id === "mask") {
      near(pixel(0.2, 0.2), [34, 68, 170]);
      near(pixel(0.4, 0.5), [0, 255, 0]);
    }
    if (id === "shadow") near(pixel(0.85, 0.5), [0, 0, 0]);
    if (id === "border") near(pixel(0.85, 0.5), [255, 255, 255]);
    if (id === "blur-region") {
      expect(pixel(0.495, 0.5)[0]).toBeGreaterThan(60);
      near(pixel(0.25, 0.5), [0, 255, 0]);
    }
    if (id === "media-matte") {
      near(pixel(0.05, 0.05), [16, 19, 25]);
      near(pixel(0.3, 0.5), [34, 68, 170]);
      await page
        .getByLabel("媒体遮罩模式", { exact: true })
        .selectOption("alpha-invert");
      pixel = await pixels("matte-invert");
      near(pixel(0.05, 0.05), [34, 68, 170]);
      near(pixel(0.3, 0.5), [16, 19, 25]);
      await page
        .getByLabel("媒体遮罩模式", { exact: true })
        .selectOption("luma");
      await page.getByLabel("不透明度 (%)", { exact: true }).fill("50");
      pixel = await pixels("matte-luma-opacity");
      near(pixel(0.3, 0.5), [22, 37, 77]);
      await page.getByLabel("不透明度 (%)", { exact: true }).fill("100");
    }
    await page
      .getByRole("switch", { name: `启用${name}`, exact: true })
      .uncheck();
    pixel = await pixels(`${id}-disabled`);
    near(pixel(0.3, 0.5), [0, 255, 0]);
    await page.getByLabel(`${name}选项`, { exact: true }).click();
    await page
      .getByRole("button", { name: `重置${name}`, exact: true })
      .click();
    await expect(
      page.getByRole("switch", { name: `启用${name}`, exact: true }),
    ).toBeChecked();
    await page.getByLabel(`${name}选项`, { exact: true }).click();
    await page
      .getByRole("button", { name: `移除${name}`, exact: true })
      .click();
    await expect(properties).toHaveCount(0);
    await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
    await expect(properties).toBeVisible();
    await page.getByLabel(`${name}选项`, { exact: true }).click();
    await page
      .getByRole("button", { name: `移除${name}`, exact: true })
      .click();
  }
  await page.getByLabel("搜索视觉效果").fill("阴影");
  await expect(page.locator(".visual-effect-card")).toHaveCount(1);
  await page.getByLabel("清除视觉效果搜索").click();
  await page
    .locator('.visual-effect-card[data-effect="shadow"]')
    .dragTo(page.locator(".timeline-clip.image"));
  await expect(
    page.getByRole("region", { name: "阴影属性", exact: true }),
  ).toBeVisible();
  const final = await save();
  expect(
    final.clips.find((clip) => clip.id === "source").visualEffects.shadow
      .enabled,
  ).toBe(true);
  execFileSync(
    ffmpeg,
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=320x180:r=10:d=1",
      "-f",
      "lavfi",
      "-i",
      "color=c=white:s=320x180:r=10:d=1",
      "-filter_complex",
      "[0:v][1:v]concat=n=2:v=1:a=0",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      path.join(root, "video.mp4"),
    ],
    { windowsHide: true },
  );
  for (const kind of ["shape", "text", "video"]) {
    await app.close();
    const fixture = structuredClone(project);
    const clip = fixture.clips[0];
    clip.kind = kind;
    if (kind === "video") {
      fixture.assets.push({
        id: "video",
        name: "video",
        path: "video.mp4",
        kind: "video",
        duration: 2,
        width: 320,
        height: 180,
        hasAudio: false,
      });
      clip.assetId = "video";
      clip.duration = 2;
    } else {
      delete clip.assetId;
      clip.transform.scale = kind === "shape" ? 0.32 : 1;
      clip.shape = "ellipse";
      clip.fill = "#ffffff";
      clip.text = "I";
      clip.style.fontSize = 120;
      clip.style.outlineWidth = 0;
      clip.style.fillEnabled = false;
    }
    const fixtureFile = path.join(root, `${kind}.troncut`);
    await fs.writeFile(fixtureFile, JSON.stringify(fixture));
    app = await electron.launch({ args: [".", fixtureFile], env });
    page = await app.firstWindow();
    page.on("pageerror", (error) => errors.push(error.message));
    await expect(page.locator(".timeline-clip")).toHaveCount(2);
    await page.getByRole("button", { name: "视觉效果", exact: true }).click();
    await page
      .locator('.visual-effect-card[data-effect="media-matte"]')
      .dragTo(page.locator('.canvas .preview-layer[data-clip-id="source"]'));
    if (kind === "video") {
      await page
        .getByLabel("媒体遮罩模式", { exact: true })
        .selectOption("luma");
      near((await pixels("video-black"))(0.3, 0.5), [16, 19, 25]);
      await page.getByLabel("播放进度", { exact: true }).focus();
      await page.keyboard.press("Home");
      for (let index = 0; index < 12; index++)
        await page.keyboard.press("ArrowRight");
      await expect
        .poll(async () => (await pixels("video-white"))(0.3, 0.5)[2])
        .toBeGreaterThan(150);
    } else {
      const pixel = await pixels(`matte-${kind}`);
      near(pixel(0.05, 0.05), [16, 19, 25]);
      near(pixel(0.5, 0.5), [34, 68, 170]);
    }
  }
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      root,
      checks:
        "七项原生拖放、预览像素、属性、开关、重置、移除、撤销、保存、搜索、时间轴拖放、区域移动/缩放、文字/形状/视频哑光与视频寻帧",
      rendererErrors: errors,
    }),
  );
} catch (error) {
  if (app) {
    const failed = await app.firstWindow();
    await failed
      .screenshot({ path: path.join(root, "failure.png") })
      .catch(() => {});
    console.error(
      await failed.evaluate(() => ({
        videos: [...document.querySelectorAll("video")].map((video) => {
          let sample;
          try {
            const canvas = document.createElement("canvas");
            canvas.width = 1;
            canvas.height = 1;
            canvas.getContext("2d").drawImage(video, 0, 0, 1, 1);
            sample = [...canvas.getContext("2d").getImageData(0, 0, 1, 1).data];
          } catch (error) {
            sample = String(error);
          }
          return {
            currentTime: video.currentTime,
            readyState: video.readyState,
            sample,
          };
        }),
        matteImages: [...document.querySelectorAll("mask image")].map(
          (image) => ({
            dataUrl: image.getAttribute("href")?.startsWith("data:"),
            length: image.getAttribute("href")?.length,
          }),
        ),
      })),
    );
  }
  console.error(root);
  throw error;
} finally {
  await app?.close();
}
