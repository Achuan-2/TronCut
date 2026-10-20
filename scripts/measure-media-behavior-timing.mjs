import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

// This fixture is a green logo on black, in eleven fixed 30fps segments.
// Compare each video to its own neutral segment to remove codec/color bias.
const source = path.resolve("references/camtasia/媒体行为动画照搬");
const video = path.resolve(
  process.argv[2] ?? path.join(source, "媒体行为动画照搬.mp4"),
);
const root = path.resolve(`test-output/media-behavior-timing-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const original = JSON.parse(
  await fs.readFile(
    path.join(source, "媒体行为动画照搬.tscproj/媒体行为动画照搬.tscproj"),
    "utf8",
  ),
);
const number = (value) =>
  typeof value === "string"
    ? value
        .split("/")
        .map(Number)
        .reduce((a, b) => a / b)
    : value;
const clips = original.timeline.sceneTrack.scenes[0].csml.tracks
  .flatMap((track) => track.medias ?? [])
  .filter((clip) => clip.effects?.[0]?.in)
  .map((clip) => ({
    start: clip.start / original.editRate,
    duration: clip.duration / original.editRate,
    style: clip.effects[0].in.attributes.name,
    suggested:
      number(clip.effects[0].in.attributes.suggestedDurationPerCharacter) /
      original.editRate,
  }));
const width = 480,
  height = 270,
  fps = 30,
  frameBytes = width * height * 3;
const binary = (name) =>
  path.resolve(
    `resources/bin/${name}${process.platform === "win32" ? ".exe" : ""}`,
  );
const stream = JSON.parse(
  execFileSync(
    binary("ffprobe"),
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,avg_frame_rate,nb_frames,duration",
      "-of",
      "json",
      video,
    ],
    { encoding: "utf8", windowsHide: true },
  ),
).streams[0];
if (number(stream.avg_frame_rate) !== fps)
  throw new Error(`Expected ${fps}fps, got ${stream.avg_frame_rate}`);
const frames = [],
  metrics = [];
const thresholds = {
  mass: 0.05,
  positionPixels: 2,
  // Subpixel centroid noise around a quantized YUV420 translation boundary.
  positionTolerance: 0.125,
  shape: 0.08,
  consecutiveFrames: 15,
};
const child = spawn(
  binary("ffmpeg"),
  [
    "-v",
    "error",
    "-i",
    video,
    "-vf",
    `scale=${width}:${height}`,
    "-pix_fmt",
    "rgb24",
    "-fps_mode",
    "passthrough",
    "-f",
    "rawvideo",
    "pipe:1",
  ],
  { windowsHide: true },
);
let carry = Buffer.alloc(0),
  error = "";
child.stderr.on("data", (chunk) => {
  error += chunk;
});
child.stdout.on("data", (chunk) => {
  carry = Buffer.concat([carry, chunk]);
  let offset = 0;
  while (carry.length - offset >= frameBytes) {
    const rgb = carry.subarray(offset, offset + frameBytes);
    const pixels = new Uint8Array(width * height);
    let mass = 0,
      x = 0,
      y = 0,
      left = width,
      right = -1,
      top = height,
      bottom = -1;
    for (let row = 0; row < height; row++)
      for (let col = 0; col < width; col++) {
        const index = row * width + col;
        const g = rgb[index * 3 + 1];
        const value = g > 4 ? g : 0;
        pixels[index] = value;
        mass += value;
        x += value * col;
        y += value * row;
        if (value > 4) {
          left = Math.min(left, col);
          right = Math.max(right, col);
          top = Math.min(top, row);
          bottom = Math.max(bottom, row);
        }
      }
    frames.push(pixels);
    metrics.push({
      mass,
      x: mass ? x / mass : 0,
      y: mass ? y / mass : 0,
      width: Math.max(0, right - left + 1),
      height: Math.max(0, bottom - top + 1),
    });
    offset += frameBytes;
  }
  carry = Buffer.from(carry.subarray(offset));
});
await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", (code) =>
    code === 0 ? resolve() : reject(new Error(error)),
  );
});
const expectedFrames = Math.round(
  Math.max(...clips.map((clip) => clip.start + clip.duration)) * fps,
);
if (frames.length !== expectedFrames || carry.length)
  throw new Error(
    `Expected the reference layout (${expectedFrames} frames at ${fps}fps), got ${frames.length} frames.`,
  );
const baselineIndex =
  Math.round(clips.find((clip) => clip.style === "none").start * fps) + fps;
const base = metrics[baselineIndex],
  reference = frames[baselineIndex];
const sample = (frame, x, y) => {
  const left = Math.floor(x),
    top = Math.floor(y),
    dx = x - left,
    dy = y - top;
  const at = (col, row) =>
    col >= 0 && col < width && row >= 0 && row < height
      ? frame[row * width + col]
      : 0;
  return (
    at(left, top) * (1 - dx) * (1 - dy) +
    at(left + 1, top) * dx * (1 - dy) +
    at(left, top + 1) * (1 - dx) * dy +
    at(left + 1, top + 1) * dx * dy
  );
};
const radius = Math.ceil(Math.max(base.width, base.height) / 2) + 16;
for (let index = 0; index < frames.length; index++) {
  const m = metrics[index];
  m.massRatio = m.mass / base.mass;
  m.dx = m.x - base.x;
  m.dy = m.y - base.y;
  let difference = 0;
  if (m.massRatio > 0.05 && m.massRatio < 4) {
    for (let y = -radius; y <= radius; y++)
      for (let x = -radius; x <= radius; x++)
        difference += Math.abs(
          sample(frames[index], m.x + x, m.y + y) / m.massRatio -
            sample(reference, base.x + x, base.y + y),
        );
    m.shapeError = difference / base.mass;
  } else m.shapeError = null;
  m.close =
    Math.abs(m.massRatio - 1) <= thresholds.mass &&
    Math.abs(m.dx) <=
      thresholds.positionPixels + thresholds.positionTolerance &&
    Math.abs(m.dy) <=
      thresholds.positionPixels + thresholds.positionTolerance &&
    m.shapeError !== null &&
    m.shapeError <= thresholds.shape;
}
const results = clips
  .filter((clip) => clip.style !== "none")
  .map((clip) => {
    const startFrame = Math.round(clip.start * fps);
    const samples = metrics.slice(
      startFrame,
      startFrame + Math.round(Math.min(3, clip.duration) * fps),
    );
    // Ignore a held boundary frame before an effect's first visible change.
    const departure = samples.findIndex((m) => !m.close);
    const first = samples.findIndex((m, index) => m.close && index > departure);
    const sustained = samples.findIndex(
      (m, index) =>
        index > departure &&
        index + thresholds.consecutiveFrames <= samples.length &&
        samples
          .slice(index, index + thresholds.consecutiveFrames)
          .every((item) => item.close),
    );
    return {
      ...clip,
      startFrame,
      firstCloseFrame: first < 0 ? null : first,
      stableFrame: sustained < 0 ? null : sustained,
      firstCloseSeconds: first < 0 ? null : first / fps,
      stableSeconds: sustained < 0 ? null : sustained / fps,
      samples,
    };
  });
await fs.writeFile(
  path.join(root, "measurements.json"),
  JSON.stringify(
    {
      video,
      stream,
      fps,
      analysisSize: { width, height },
      frameCount: frames.length,
      baselineIndex,
      baseline: base,
      thresholds,
      results,
    },
    null,
    2,
  ),
);
const times = [0, 0.2, 0.4, 0.6, 0.8, 1, 1.2, 1.5, 2, 2.5];
const tiles = [];
for (const [row, clip] of results.entries()) {
  for (const [col, time] of times.entries()) {
    const frame = frames[Math.round((clip.start + time) * fps)];
    const rgb = Buffer.alloc(width * height * 3);
    for (let i = 0; i < frame.length; i++) {
      rgb[i * 3] = frame[i];
      rgb[i * 3 + 1] = frame[i];
      rgb[i * 3 + 2] = frame[i];
    }
    const label = Buffer.from(
      `<svg width="240" height="135"><text x="5" y="14" fill="yellow" font-size="11">${clip.style} ${time.toFixed(2)}s</text></svg>`,
    );
    const input = await sharp(rgb, { raw: { width, height, channels: 3 } })
      .resize(240, 135)
      .composite([{ input: label }])
      .png()
      .toBuffer();
    tiles.push({ input, left: col * 240, top: row * 135 });
  }
}
await sharp({
  create: {
    width: times.length * 240,
    height: results.length * 135,
    channels: 3,
    background: "black",
  },
})
  .composite(tiles)
  .png()
  .toFile(path.join(root, "reference-contact.png"));
console.log(
  JSON.stringify(
    {
      root,
      baseline: base,
      results: results.map(({ samples, ...result }) => result),
    },
    null,
    2,
  ),
);
