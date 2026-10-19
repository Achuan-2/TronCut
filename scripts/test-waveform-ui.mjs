import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimelineZoom } from "./timeline-zoom.mjs";

const root = path.resolve(`test-output/waveform-ui-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const bundle = await build({
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
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const rate = 48000,
  seconds = 60;
const wav = Buffer.alloc(44 + rate * seconds * 2);
wav.write("RIFF", 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24);
wav.writeUInt32LE(rate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(wav.length - 44, 40);
for (let i = 0; i < rate * seconds; i++) {
  const amplitude = [0, 0.09, 0.81, 0.25][Math.floor(i / rate) % 4];
  wav.writeInt16LE(
    Math.round(Math.sin((2 * Math.PI * 6000 * i) / rate) * amplitude * 32767),
    44 + i * 2,
  );
}
await fs.writeFile(path.join(root, "tone.wav"), wav);
const project = createProject("高清波形验证");
project.tracks = [newTrack(0), newTrack(1)];
project.assets = [
  {
    id: "tone",
    name: "6000Hz 阶梯音频",
    path: "tone.wav",
    kind: "audio",
    width: 0,
    height: 0,
    duration: seconds,
    hasAudio: true,
  },
];
project.clips = [
  {
    ...newText(project.tracks[0].id, 0),
    id: "trimmed",
    kind: "audio",
    assetId: "tone",
    sourceIn: 0.95,
    duration: 55,
  },
  {
    ...newText(project.tracks[1].id, 0),
    id: "stitched",
    kind: "audio",
    assetId: "tone",
    duration: 1.5,
    speed: 2,
    stitch: [
      { sourceIn: 2, duration: 1 },
      { sourceIn: 0, duration: 1 },
      { sourceIn: 1, duration: 1 },
    ],
  },
];
const file = path.join(root, "fixture.troncut");
await fs.writeFile(file, JSON.stringify(project));
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: path.join(root, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const deviceScale = Number(process.env.FRAMECRAFT_WAVEFORM_DPR || 2);
const app = await electron.launch({
  args: [".", `--force-device-scale-factor=${deviceScale}`, file],
  env,
});
const errors = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  const wave = (id) =>
    page.locator(`.timeline-clip[data-clip-id="${id}"] .timeline-waveform`);
  const trimmed = wave("trimmed"),
    stitched = wave("stitched");
  await expect(trimmed).toHaveAttribute("data-waveform-ready", "1", {
    timeout: 30000,
  });
  await expect(stitched).toHaveAttribute("data-waveform-ready", "1");
  const sample = (canvas, time) =>
    canvas.evaluate((node, local) => {
      const ratio = window.devicePixelRatio;
      const zoom = Number(node.dataset.waveformZoom);
      const x = Math.floor(
        (local * zoom - Number.parseFloat(node.style.left)) * ratio,
      );
      if (x < 0 || x >= node.width)
        throw new Error(`采样点超出画布: ${x}/${node.width}`);
      const data = node
        .getContext("2d")
        .getImageData(x, 0, 1, node.height).data;
      let filled = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i]) filled++;
      return filled / node.height;
    }, time);
  await setTimelineZoom(page, 65);
  expect(await sample(stitched, 0.25)).toBeGreaterThan(0.85);
  expect(await sample(stitched, 0.75)).toBe(0);
  expect(await sample(stitched, 1.25)).toBeGreaterThan(0.25);
  expect(await sample(stitched, 1.25)).toBeLessThan(0.4);
  await page.screenshot({ path: path.join(root, "overview.png") });
  const cacheDir = path.join(root, "profile", "thumbnails");
  const cacheFiles = (await fs.readdir(cacheDir)).filter((file) =>
    file.endsWith(".waveform"),
  );
  expect(cacheFiles).toHaveLength(1);
  const cachedTime = (await fs.stat(path.join(cacheDir, cacheFiles[0])))
    .mtimeMs;
  await setTimelineZoom(page, 2400);
  expect(await sample(trimmed, 0.02)).toBe(0);
  expect(await sample(trimmed, 0.08)).toBeGreaterThan(0.25);
  const geometry = await trimmed.evaluate((node) => ({
    pixels: node.width,
    cssWidth: parseFloat(node.style.width),
    ratio: window.devicePixelRatio,
    clipWidth: node.closest(".timeline-clip").getBoundingClientRect().width,
    alphas: [
      ...new Set(
        node
          .getContext("2d")
          .getImageData(0, 0, node.width, node.height)
          .data.filter((_, i) => i % 4 === 3),
      ),
    ],
  }));
  expect(geometry.ratio).toBe(deviceScale);
  expect(geometry.pixels).toBe(Math.ceil(geometry.cssWidth * deviceScale));
  expect(geometry.cssWidth).toBeLessThan(geometry.clipWidth / 10);
  expect(geometry.alphas.every((alpha) => alpha === 0 || alpha === 255)).toBe(
    true,
  );
  await page.screenshot({
    path: path.join(root, `zoom-2400-dpi-${deviceScale}.png`),
  });
  await page.locator(".timeline-scroll").evaluate((node) => {
    node.scrollLeft = 2400 * 1.8;
  });
  await expect
    .poll(() => trimmed.evaluate((node) => parseFloat(node.style.left)))
    .toBeGreaterThan(3000);
  expect(await sample(trimmed, 2)).toBeGreaterThan(0.85);
  expect(await sample(trimmed, 2.15)).toBeGreaterThan(0.45);
  expect(await sample(trimmed, 2.15)).toBeLessThan(0.6);
  expect((await fs.stat(path.join(cacheDir, cacheFiles[0]))).mtimeMs).toBe(
    cachedTime,
  );
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      root,
      checks: `6000Hz 真实解码、裁剪/拼接/二倍速度、2400px/s 放大、${deviceScale}x DPI、逐像素边缘、可见范围绘制、滚动对齐、复用磁盘缓存`,
      geometry,
      rendererErrors: errors,
    }),
  );
} catch (error) {
  await (
    await app.firstWindow()
  )
    .screenshot({ path: path.join(root, "failure.png") })
    .catch(() => {});
  console.error(root);
  throw error;
} finally {
  await app.close();
}
