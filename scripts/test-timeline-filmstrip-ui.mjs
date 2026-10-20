import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import sharp from "sharp";
import { setTimelineZoom } from "./timeline-zoom.mjs";

const root = path.resolve(
  `test-output/timeline-filmstrip-ui/run-${Date.now()}`,
);
const profile = path.join(root, "profile");
const documents = path.join(root, "Documents");
await fs.mkdir(profile, { recursive: true });
await fs.mkdir(documents, { recursive: true });
const helpers = path.join(root, "helpers.cjs");
await build({
  stdin: {
    contents:
      'export { createProject, newText } from "./shared/model"; export { setFrameExtension } from "./shared/frame-extension"; export { probeMedia } from "./electron/media"; export { saveProject } from "./electron/project-store"; export { findBinary, runProcess } from "./electron/process";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  packages: "external",
  format: "cjs",
  outfile: helpers,
});
const {
  createProject,
  newText,
  setFrameExtension,
  probeMedia,
  saveProject,
  findBinary,
  runProcess,
} = createRequire(import.meta.url)(helpers);
const source = path.join(root, "colors.mp4");
await runProcess(findBinary("ffmpeg"), [
  "-y",
  ...["red", "lime", "blue", "yellow"].flatMap((color) => [
    "-f",
    "lavfi",
    "-i",
    `color=c=${color}:s=320x180:r=20:d=2`,
  ]),
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:duration=8",
  "-filter_complex",
  "[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0[v]",
  "-map",
  "[v]",
  "-map",
  "4:a",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  source,
]);
const image = path.join(root, "image.png");
await sharp({
  create: { width: 320, height: 180, channels: 3, background: "#e24ca3" },
})
  .png()
  .toFile(image);
let project = createProject("时间线画面预览");
project.canvas.fps = 20;
project.tracks.find((track) => track.id === "video").height = 120;
project.tracks.find((track) => track.id === "titles").height = 90;
project.tracks.find((track) => track.id === "audio").height = 40;
const video = await probeMedia(source);
const picture = await probeMedia(image);
project.assets = [video, picture];
project.clips = [
  {
    ...newText("video", 0),
    id: "video",
    name: "裁剪后的视频",
    kind: "video",
    assetId: video.id,
    sourceIn: 2,
    duration: 6,
  },
  {
    ...newText("video", 7),
    id: "freeze",
    name: "帧定格预览",
    kind: "video",
    assetId: video.id,
    duration: 4,
  },
  {
    ...newText("titles", 0),
    id: "image",
    name: "图片预览",
    kind: "image",
    assetId: picture.id,
    duration: 8,
  },
  {
    ...newText("titles", 10),
    id: "loop",
    name: "长循环视频",
    kind: "video",
    assetId: video.id,
    duration: 600,
    loop: true,
  },
];
project = setFrameExtension(project, "freeze", 2, 1);
const file = path.join(root, "project", "fixture.troncut");
await saveProject(project, file);
const fixture = JSON.parse(await fs.readFile(file, "utf8"));
fixture.assets.push({ ...picture, id: "missing", path: "missing.png" });
fixture.clips.push({
  ...newText("audio", 0),
  id: "offline",
  kind: "image",
  assetId: "missing",
  duration: 5,
});
await fs.writeFile(file, JSON.stringify(fixture));
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [".", file], env });
const page = await app.firstWindow();
await app.evaluate(({ app, BrowserWindow }, directory) => {
  app.setPath("documents", directory);
  BrowserWindow.getAllWindows()[0].setSize(1440, 1000);
}, documents);
page.setDefaultTimeout(15000);
await app.evaluate(() => {
  const childProcess = process.getBuiltinModule("child_process");
  const spawn = childProcess.spawn;
  globalThis.filmstripDecodes = [];
  globalThis.activeFilmstripDecodes = 0;
  childProcess.spawn = function (binary, args, options) {
    const child = spawn.call(this, binary, args, options);
    if (args.some((arg) => String(arg).startsWith("scale=160:90:"))) {
      globalThis.filmstripDecodes.push(args[args.indexOf("-ss") + 1]);
      globalThis.activeFilmstripDecodes++;
      child.once("close", () => globalThis.activeFilmstripDecodes--);
    }
    return child;
  };
});
const decodeCount = () =>
  app.evaluate(() => globalThis.filmstripDecodes.length);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const clip = (id) => page.locator(`.timeline-clip[data-clip-id="${id}"]`);
const ready = async (id) => {
  await expect(clip(id).locator(".timeline-thumbnail").first()).toBeAttached();
  await expect
    .poll(() =>
      clip(id)
        .locator(".timeline-thumbnail")
        .evaluateAll((tiles) =>
          tiles.every(
            (tile) =>
              tile.querySelector("img")?.naturalWidth > 0 &&
              tile.dataset.thumbnailReady === "1",
          ),
        ),
    )
    .toBe(true);
};
try {
  await expect(clip("video")).toBeVisible();
  await setTimelineZoom(page, 100);
  await ready("video");
  await ready("image");
  const colors = await clip("video")
    .locator(".timeline-thumbnail")
    .evaluateAll((tiles) =>
      tiles.map((tile) => {
        const image = tile.querySelector("img");
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, 1, 1);
        return {
          time: Number(tile.dataset.sourceTime),
          rgb: [...context.getImageData(0, 0, 1, 1).data].slice(0, 3),
        };
      }),
    );
  expect(colors.some(({ rgb }) => rgb[1] > 220 && rgb[0] < 30)).toBe(true);
  expect(colors.some(({ rgb }) => rgb[2] > 220 && rgb[0] < 30)).toBe(true);
  for (const { time, rgb } of colors) {
    if (time < 4) expect(rgb[1]).toBeGreaterThan(220);
    else if (time < 6) expect(rgb[2]).toBeGreaterThan(220);
    else expect(rgb[0]).toBeGreaterThan(220);
  }
  expect(
    new Set(
      await clip("image")
        .locator(".timeline-thumbnail img")
        .evaluateAll((images) => images.map((image) => image.src)),
    ).size,
  ).toBe(1);
  await expect(clip("video").locator(".clip-label")).toContainText(
    "裁剪后的视频",
  );
  await expect(clip("video").locator(".clip-duration")).toContainText("00:06");
  await expect(clip("video").locator(".timeline-waveform")).toHaveAttribute(
    "data-waveform-ready",
    "1",
  );
  await expect(clip("offline").locator(".timeline-filmstrip")).toHaveCount(0);
  await page
    .locator(".timeline")
    .screenshot({ path: path.join(root, "filmstrip.png") });
  // Same density tier: resize existing images without invoking new decoders.
  await ready("freeze");
  if (await clip("loop").locator(".timeline-thumbnail").count())
    await ready("loop");
  await expect
    .poll(() => app.evaluate(() => globalThis.activeFilmstripDecodes))
    .toBe(0);
  const beforeZoom = await decodeCount();
  await page.evaluate(() => {
    globalThis.filmstripFrames = { checked: 0, blank: 0 };
    globalThis.watchFilmstrip = true;
    const sample = () => {
      if (!globalThis.watchFilmstrip) return;
      const tiles = document.querySelectorAll(
        '.timeline-clip[data-clip-id="video"] .timeline-thumbnail',
      );
      globalThis.filmstripFrames.checked++;
      if ([...tiles].some((tile) => !tile.querySelector("img")?.naturalWidth))
        globalThis.filmstripFrames.blank++;
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  for (const zoom of [90, 110, 95, 105, 100]) {
    await setTimelineZoom(page, zoom);
    await ready("video");
  }
  expect(await decodeCount()).toBe(beforeZoom);
  // A finer tier adds only missing samples and uses cached images immediately.
  await setTimelineZoom(page, 200);
  await expect
    .poll(
      async () => await clip("video").locator(".timeline-thumbnail").count(),
    )
    .toBeGreaterThan(colors.length);
  await ready("video");
  if (await clip("freeze").locator(".timeline-thumbnail").count())
    await ready("freeze");
  await expect
    .poll(() => app.evaluate(() => globalThis.activeFilmstripDecodes))
    .toBe(0);
  const afterFine = await decodeCount();
  expect(afterFine).toBeGreaterThan(beforeZoom);
  for (const zoom of [100, 200, 100]) {
    await setTimelineZoom(page, zoom);
    await ready("video");
  }
  expect(await decodeCount()).toBe(afterFine);
  const zoomFrames = await page.evaluate(() => {
    globalThis.watchFilmstrip = false;
    return globalThis.filmstripFrames;
  });
  expect(zoomFrames.checked).toBeGreaterThan(0);
  expect(zoomFrames.blank).toBe(0);
  console.log(JSON.stringify({ beforeZoom, afterFine, zoomFrames }));
  // Thumbnails never intercept selection, context menus or trimming gestures.
  await clip("video").click({ position: { x: 50, y: 35 } });
  await expect(clip("video")).toHaveClass(/selected/);
  await clip("video").click({ button: "right", position: { x: 50, y: 35 } });
  await expect(
    page.getByRole("menuitem", { name: "重命名", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  const trim = await clip("video").locator(".trim-handle.right").boundingBox();
  await page.mouse.move(trim.x + trim.width / 2, trim.y + trim.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    trim.x + trim.width / 2 - 50,
    trim.y + trim.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect
    .poll(() =>
      clip("video").evaluate((element) => parseFloat(element.style.width)),
    )
    .toBeLessThan(580);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect
    .poll(() =>
      clip("video").evaluate((element) => parseFloat(element.style.width)),
    )
    .toBeCloseTo(600, 0);
  await setTimelineZoom(page, 180);
  await ready("video");
  const scroll = page.locator(".timeline-scroll");
  await scroll.evaluate((element) => {
    element.scrollLeft = 1300;
  });
  await ready("freeze");
  const frozen = await clip("freeze")
    .locator(".timeline-thumbnail")
    .evaluateAll((tiles) =>
      tiles
        .filter((tile) => {
          const left = Number.parseFloat(tile.style.left) / 180;
          return left >= 2 && left < 3;
        })
        .map((tile) => ({
          time: Number(tile.dataset.sourceTime),
          src: tile.querySelector("img")?.src,
        })),
    );
  expect(frozen.length).toBeGreaterThan(0);
  expect(frozen.every((tile) => tile.time === 2)).toBe(true);
  expect(new Set(frozen.map((tile) => tile.src)).size).toBe(1);
  await scroll.evaluate((element) => {
    element.scrollLeft = 20000;
  });
  await ready("loop");
  expect(await page.locator(".timeline-thumbnail").count()).toBeLessThan(60);
  expect(
    await clip("loop")
      .locator(".timeline-thumbnail")
      .evaluateAll((tiles) =>
        tiles.every((tile) => Number(tile.dataset.sourceTime) < 8),
      ),
  ).toBe(true);
  await page
    .locator(".timeline")
    .screenshot({ path: path.join(root, "scrolled.png") });
  await scroll.evaluate((element) => {
    element.scrollLeft = 0;
  });
  await setTimelineZoom(page, 100);
  await ready("video");
  await ready("image");
  // At high zoom, the cursor follows pixels while the decoder shares video
  // frames. Only releasing the handle snaps its final position to a frame.
  await page.getByLabel("播放进度", { exact: true }).fill("3");
  await setTimelineZoom(page, 2400);
  await ready("video");
  const head = page.getByRole("button", { name: "播放头", exact: true });
  const headBox = await head.boundingBox();
  const headX = headBox.x + headBox.width / 2,
    headY = headBox.y + 7;
  await page.mouse.move(headX, headY);
  await page.mouse.down();
  await page.evaluate(() => {
    globalThis.scrubFrames = [];
    globalThis.scrubSeeks = 0;
    globalThis.watchScrub = true;
    document
      .querySelector(".preview-layer.video video")
      .addEventListener("seeking", () => globalThis.scrubSeeks++);
    const sample = () => {
      if (!globalThis.watchScrub) return;
      globalThis.scrubFrames.push(
        new DOMMatrix(document.querySelector(".ruler-playhead").style.transform)
          .m41,
      );
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.mouse.move(headX + 477, headY, { steps: 120 });
  const scrub = await page.evaluate(() => {
    globalThis.watchScrub = false;
    return {
      positions: globalThis.scrubFrames,
      seeks: globalThis.scrubSeeks,
      time:
        new DOMMatrix(document.querySelector(".ruler-playhead").style.transform)
          .m41 / 2400,
    };
  });
  expect(new Set(scrub.positions).size).toBeGreaterThan(30);
  expect(
    Math.abs(scrub.time * 20 - Math.round(scrub.time * 20)),
  ).toBeGreaterThan(0.001);
  expect(scrub.seeks).toBeLessThan(12);
  await page.mouse.up();
  await expect
    .poll(async () =>
      Number(await page.getByLabel("播放进度", { exact: true }).inputValue()),
    )
    .toBeCloseTo(3.2, 7);
  await expect
    .poll(() =>
      page
        .locator(".preview-layer.video video")
        .evaluate((video) => video.currentTime),
    )
    .toBeCloseTo(5.2, 3);
  // A final pointer movement and release in the same task must flush the final
  // position instead of allowing a stale animation frame to overwrite it.
  const finalBox = await head.boundingBox();
  const finalX = finalBox.x + finalBox.width / 2;
  await page.mouse.move(finalX, headY);
  await page.mouse.down();
  await head.evaluate(
    (element, position) => {
      for (const type of ["pointermove", "pointerup"])
        element.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerId: 1,
            buttons: type === "pointermove" ? 1 : 0,
            clientX: position.x + 95,
            clientY: position.y,
          }),
        );
    },
    { x: finalX, y: headY },
  );
  await page.mouse.up();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  expect(
    Number(await page.getByLabel("播放进度", { exact: true }).inputValue()),
  ).toBeCloseTo(3.25, 7);
  console.log(
    JSON.stringify({
      scrubPositions: new Set(scrub.positions).size,
      scrubSeeks: scrub.seeks,
    }),
  );
  await page
    .locator(".timeline")
    .screenshot({ path: path.join(root, "high-zoom-scrubbing.png") });
  expect(errors).toEqual([]);
  console.log(
    `视频连续源帧、图片平铺、名称时长与波形、选中/右键、帧定格、循环、缩放与可见区域加载通过：${root}`,
  );
} catch (error) {
  await page
    .screenshot({ path: path.join(root, "failure.png") })
    .catch(() => {});
  throw error;
} finally {
  await app.close();
}
